#!/bin/sh
# backup 容器的主进程：每天 BACKUP_TIME（北京时间）跑一次 backup.sh。跑失败了第二天照样再跑。
. "$(dirname "$0")/lib.sh"

at="${BACKUP_TIME:-03:30}"
echo "$at" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]$' || fail "BACKUP_TIME 要写成 HH:MM，现在是 $at"
mkdir -p "$BACKUP_DIR"
date +%s > /tmp/started
if remote_enabled; then
  log "每天 $at 备份，传到 $(setup_remote; remote_path)，保留 ${BACKUP_RETENTION_DAYS:-30} 天；本机留 ${BACKUP_LOCAL_DAYS:-7} 天"
else
  log "每天 $at 备份。没有配置对象存储，只存本机 ${BACKUP_LOCAL_DAYS:-7} 天"
fi

while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $at" +%s)
  if [ "$next" -le "$now" ]; then
    next=$((next + 86400))
  fi
  log "下一次备份：$(date -d "@$next" '+%Y-%m-%d %H:%M')"
  sleep $((next - now))
  "$(dirname "$0")/backup.sh" || log "这次备份失败了，明天同一时间再试；也可以手动 ./prepaid.sh backup"
done
