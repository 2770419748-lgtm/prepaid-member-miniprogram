#!/bin/sh
# 用一份备份覆盖正在用的数据库（真出事时才用）。先另存一份当前的库，再恢复。
# 不要直接跑，用 ./prepaid.sh restore <备份文件名|latest>：它会先停接口、要你确认，完了再启动。
. "$(dirname "$0")/lib.sh"

want="${1:-}"
[ -n "$want" ] || fail "要指定备份：文件名，或者 latest"
[ "${CONFIRM_RESTORE:-}" = "yes" ] || fail "没有确认。请用 ./prepaid.sh restore"
tmp=$(mktemp -d "$BACKUP_DIR/.restore-XXXXXX")
trap 'rm -rf "$tmp"' EXIT

file=$(fetch_backup "$want" "$tmp")
log "用这份备份恢复：$(basename "$file")"
unpack "$file" "$tmp/x"

safety="$BACKUP_DIR/before-restore-$(date +%Y%m%d-%H%M%S).dump"
pg_dump -Fc -f "$safety" || fail "另存当前的库失败，没有动任何数据"
log "当前的库另存为 $(basename "$safety")（恢复错了可以用它找回）"

# 整个库删掉重建，再导入。账本只追加的规则（触发器）跟着备份一起恢复。
psql -X -q -v ON_ERROR_STOP=1 -d postgres \
  -c "DROP DATABASE IF EXISTS \"$PGDATABASE\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$PGDATABASE\" OWNER \"$PGUSER\"" >/dev/null \
  || fail "清空当前库失败。当前的库在 $(basename "$safety")"
pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" "$tmp/x/db.dump" \
  || fail "恢复出错。当前的库在 $(basename "$safety")，可以再用 ./prepaid.sh restore $(basename "$safety") 找回"

bad=$(balance_mismatches "$PGDATABASE" 2>/dev/null || echo "?")
if [ "$bad" = "?" ]; then
  log "注意：恢复后核对不了余额（库里没有账本表？），请先别营业，联系开发排查"
elif [ "$bad" != "0" ]; then
  log "注意：恢复后有 $bad 张卡的余额和流水对不上，请先别营业，联系开发排查"
else
  log "核对过了：每张卡的余额都等于它所有流水加减的结果"
fi

if [ -f "$tmp/x/storage.tar.gz" ]; then
  restore_to="${RESTORE_STORAGE_DIR:-/restore-storage}"
  if [ -d "$restore_to" ]; then
    tar -xzf "$tmp/x/storage.tar.gz" -C "$restore_to" || fail "恢复合同文件失败（数据库已经恢复）"
    log "合同文件已恢复"
  else
    log "备份里有合同文件，但没有挂上合同目录，没恢复文件"
  fi
fi
log "恢复完成。"
