#!/bin/sh
# 备份脚本共用的函数。在 backup 容器里运行（postgres:16-alpine + rclone + openssl）。
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
STORAGE_DIR="${STORAGE_DIR:-/data/storage}"
# psql 的 NOTICE（比如「库不存在，跳过」）不打印，免得像出错。
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
  log "失败：$*" >&2
  exit 1
}

bucket() {
  echo "${BACKUP_BUCKET:-${S3_BUCKET:-}}"
}

# 配了对象存储才上传；没配只留本机，并且每次都提醒。
remote_enabled() {
  [ -n "${S3_ENDPOINT:-}" ] && [ -n "$(bucket)" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]
}

# rclone 用环境变量配置一个名叫 oss 的远端，不落配置文件（配置路径叫 notfound 时 rclone 只在内存里放配置）。
setup_remote() {
  export RCLONE_CONFIG=/notfound
  export RCLONE_CONFIG_OSS_TYPE=s3
  export RCLONE_CONFIG_OSS_PROVIDER="${BACKUP_S3_PROVIDER:-Alibaba}"
  export RCLONE_CONFIG_OSS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
  export RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"
  export RCLONE_CONFIG_OSS_ENDPOINT="${S3_ENDPOINT:-}"
  if [ -n "${S3_REGION:-}" ]; then
    export RCLONE_CONFIG_OSS_REGION="${S3_REGION}"
  fi
  if [ "${S3_FORCE_PATH_STYLE:-false}" = "true" ]; then
    export RCLONE_CONFIG_OSS_FORCE_PATH_STYLE=true
  else
    export RCLONE_CONFIG_OSS_FORCE_PATH_STYLE=false
  fi
  # 不自动建 Bucket，Bucket 要在控制台建好并设成私有。
  export RCLONE_CONFIG_OSS_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_OSS_ACL=private
}

remote_path() {
  echo "oss:$(bucket)/${BACKUP_PREFIX:-db-backups}"
}

# 解开一份备份（.tar 或加密的 .tar.enc）到指定目录。
unpack() {
  file="$1"
  target="$2"
  mkdir -p "$target"
  case "$file" in
    *.tar.enc)
      [ -n "${BACKUP_PASSPHRASE:-}" ] || fail "这份备份是加密的，deploy/.env 里要有 BACKUP_PASSPHRASE"
      openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" | tar -xf - -C "$target" \
        || fail "解密失败：口令不对或文件损坏"
      ;;
    *.tar)
      tar -xf "$file" -C "$target" || fail "解包失败：文件损坏"
      ;;
    *.dump)
      # 恢复前自动另存的那份（before-restore-*.dump），只有数据库。
      cp "$file" "$target/db.dump"
      ;;
    *)
      fail "不认识的备份文件：$file"
      ;;
  esac
  [ -f "$target/db.dump" ] || fail "备份里没有 db.dump"
  if [ -f "$target/SHA256SUMS" ]; then
    (cd "$target" && sha256sum -c SHA256SUMS >/dev/null) || fail "备份校验和对不上，文件可能损坏"
  fi
}

# 找一份备份：latest = 对象存储上最新的（没配对象存储就用本机最新的）；也可以给文件名或本机路径。
fetch_backup() {
  want="$1"
  dest="$2"
  if [ -f "$want" ]; then
    echo "$want"
    return
  fi
  if [ -f "$BACKUP_DIR/$want" ]; then
    echo "$BACKUP_DIR/$want"
    return
  fi
  if remote_enabled; then
    setup_remote
    if [ "$want" = "latest" ]; then
      want=$(rclone lsf --files-only "$(remote_path)" | grep '^prepaid-' | sort | tail -n 1)
      [ -n "$want" ] || fail "对象存储上还没有备份"
    fi
    log "从对象存储下载 $want" >&2
    rclone copyto "$(remote_path)/$want" "$dest/$want" || fail "下载 $want 失败"
    echo "$dest/$want"
    return
  fi
  if [ "$want" = "latest" ]; then
    latest=$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep '^prepaid-.*\.tar\(\.enc\)\?$' | sort | tail -n 1 || true)
    [ -n "$latest" ] || fail "本机还没有备份"
    echo "$BACKUP_DIR/$latest"
    return
  fi
  fail "找不到备份 $want"
}

# 每张卡的余额要等于它所有流水加减的结果（和后台「余额核对」同一算法）。打印对不上的张数。
balance_mismatches() {
  psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$1" <<'SQL'
WITH moves AS (
  SELECT e.wallet_id,
         SUM(CASE
               WHEN e.type = 'RECHARGE' THEN e.amount_cent
               WHEN e.type IN ('CONSUME', 'REFUND') THEN -e.amount_cent
               WHEN e.type = 'REVERSAL' AND o.type = 'RECHARGE' THEN -e.amount_cent
               WHEN e.type = 'REVERSAL' AND o.type IN ('CONSUME', 'REFUND') THEN e.amount_cent
               ELSE 0
             END)::bigint AS total
  FROM ledger_entries e
  LEFT JOIN ledger_entries o ON o.id = e.reversal_of_id
  GROUP BY e.wallet_id
)
SELECT COUNT(*)
FROM wallets w
LEFT JOIN moves m ON m.wallet_id = w.id
WHERE w.balance_cent <> COALESCE(m.total, 0);
SQL
}

table_counts() {
  psql -X -q -t -A -F ' ' -v ON_ERROR_STOP=1 -d "$1" <<'SQL'
SELECT 'orgs', COUNT(*) FROM orgs
UNION ALL SELECT 'stores', COUNT(*) FROM stores
UNION ALL SELECT 'staff', COUNT(*) FROM staff
UNION ALL SELECT 'members', COUNT(*) FROM members
UNION ALL SELECT 'wallets', COUNT(*) FROM wallets
UNION ALL SELECT 'ledger_entries', COUNT(*) FROM ledger_entries
UNION ALL SELECT 'sign_flows', COUNT(*) FROM sign_flows
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
SQL
}
