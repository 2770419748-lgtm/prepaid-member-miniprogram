#!/bin/sh
# 备份一次：数据库（pg_dump）+ 本机合同文件 → 一个 tar（设了口令就加密）→ 传到对象存储 → 清掉过期的。
# 每天由 schedule.sh 自动跑；手动跑：./prepaid.sh backup
. "$(dirname "$0")/lib.sh"

stamp=$(date +%Y%m%d-%H%M%S)
name="prepaid-$stamp"
work="$BACKUP_DIR/.work-$stamp"
mkdir -p "$BACKUP_DIR"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"

finish_failure() {
  date '+%Y-%m-%d %H:%M:%S' > "$BACKUP_DIR/last-failure"
  echo "$1" >> "$BACKUP_DIR/last-failure"
  fail "$1"
}

log "开始备份 $name"
pg_dump -Fc -Z 6 -f "$work/db.dump" || finish_failure "pg_dump 出错"
files=0
if [ -d "$STORAGE_DIR" ] && [ -n "$(ls -A "$STORAGE_DIR" 2>/dev/null)" ]; then
  tar -czf "$work/storage.tar.gz" -C "$STORAGE_DIR" . || finish_failure "打包合同文件出错"
  files=$(tar -tzf "$work/storage.tar.gz" | grep -vc '/$' || true)
fi
{
  echo "name=$name"
  echo "created_at=$(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo "database=${PGDATABASE:-}"
  echo "pg_dump=$(pg_dump --version)"
  echo "storage_files=$files"
} > "$work/MANIFEST"
(cd "$work" && sha256sum db.dump MANIFEST $( [ -f storage.tar.gz ] && echo storage.tar.gz ) > SHA256SUMS)

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  file="$BACKUP_DIR/$name.tar.enc"
  tar -cf - -C "$work" . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$file" \
    || finish_failure "加密出错"
else
  file="$BACKUP_DIR/$name.tar"
  tar -cf "$file" -C "$work" . || finish_failure "打包出错"
fi
size=$(du -h "$file" | cut -f1)
log "本机备份好了：$(basename "$file")（$size，合同文件 $files 个）"

where="本机"
if remote_enabled; then
  setup_remote
  rclone copyto "$file" "$(remote_path)/$(basename "$file")" --retries 5 --low-level-retries 10 \
    || finish_failure "上传到对象存储失败"
  # 上传完核对一遍大小，确认对象存储上那份是完整的。
  local_bytes=$(stat -c %s "$file")
  remote_bytes=$(rclone size --json "$(remote_path)/$(basename "$file")" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ "$local_bytes" = "$remote_bytes" ] || finish_failure "对象存储上的大小和本机不一致（$remote_bytes / $local_bytes）"
  rclone delete "$(remote_path)" --min-age "${BACKUP_RETENTION_DAYS:-30}d" --include 'prepaid-*' \
    || log "清理对象存储上的旧备份出错（不影响这次备份）"
  where="本机和对象存储 $(remote_path)"
else
  log "提醒：没有配置对象存储（S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY），备份只在这台服务器上，服务器坏了就没了"
fi

# 本机只留最近几天；恢复前另存的 before-restore-*.dump 也一样。
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'prepaid-*' -o -name 'before-restore-*' \) -mtime +"${BACKUP_LOCAL_DAYS:-7}" -delete
{
  date '+%Y-%m-%d %H:%M:%S'
  echo "$(basename "$file") $size $where"
} > "$BACKUP_DIR/last-success"
rm -f "$BACKUP_DIR/last-failure"
log "备份完成，存在$where"
