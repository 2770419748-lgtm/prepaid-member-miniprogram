#!/bin/sh
# 恢复演练：把一份备份（默认对象存储上最新的）恢复到一个临时库，核对能打开、数据齐、每张卡余额对得上，
# 然后删掉临时库。不碰正在用的库，随时可以跑：./prepaid.sh drill [备份文件名]
. "$(dirname "$0")/lib.sh"

want="${1:-latest}"
drill_db=prepaid_restore_drill
tmp=$(mktemp -d "$BACKUP_DIR/.drill-XXXXXX")
cleanup() {
  rm -rf "$tmp"
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $drill_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

file=$(fetch_backup "$want" "$tmp")
log "恢复演练用的备份：$(basename "$file")"
unpack "$file" "$tmp/x"
sed -n 's/^created_at=/备份时间：/p' "$tmp/x/MANIFEST" || true

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $drill_db" -c "CREATE DATABASE $drill_db" >/dev/null \
  || fail "建临时库失败"
pg_restore --no-owner --no-privileges --exit-on-error -d "$drill_db" "$tmp/x/db.dump" || fail "数据库恢复出错"
log "数据库恢复好了，开始核对"

# 中文按两格宽算，和下面的数字列对齐。
echo "表                备份里   现在的库"
table_counts "$drill_db" > "$tmp/restored"
table_counts "${PGDATABASE}" > "$tmp/live"
while read -r table restored; do
  live=$(awk -v t="$table" '$1 == t { print $2 }' "$tmp/live")
  printf '%-15s %8s %10s\n' "$table" "$restored" "$live"
done < "$tmp/restored"

bad=$(balance_mismatches "$drill_db")
[ "$bad" = "0" ] || fail "恢复出来有 $bad 张卡的余额和流水对不上"
log "每张卡的余额都等于它所有流水加减的结果"

if [ -f "$tmp/x/storage.tar.gz" ]; then
  count=$(tar -tzf "$tmp/x/storage.tar.gz" | grep -vc '/$' || true)
  log "合同文件包能打开，$count 个文件"
fi
log "恢复演练通过：这份备份能完整恢复。"
