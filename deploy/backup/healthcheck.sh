#!/bin/sh
# docker 健康检查：最近一次备份失败、或者超过 26 小时没有成功备份，就显示 unhealthy（./prepaid.sh status 能看到）。
BACKUP_DIR="${BACKUP_DIR:-/backups}"
now=$(date +%s)
if [ -f "$BACKUP_DIR/last-failure" ]; then
  exit 1
fi
if [ -f "$BACKUP_DIR/last-success" ]; then
  age=$((now - $(stat -c %Y "$BACKUP_DIR/last-success")))
  [ "$age" -lt 93600 ]
  exit $?
fi
# 刚装好还没到第一次备份时间。
started=$(cat /tmp/started 2>/dev/null || echo "$now")
[ $((now - started)) -lt 93600 ]
