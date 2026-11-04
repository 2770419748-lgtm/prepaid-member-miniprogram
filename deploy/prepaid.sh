#!/usr/bin/env bash
# 储值会员系统正式环境的一键脚本。在服务器上、仓库的 deploy 目录里运行：
#
#   ./prepaid.sh install        第一次安装：检查配置、生成密钥、构建、建库、启动
#   ./prepaid.sh init-company   建公司、第一家门店和超级管理员（只能一次）
#   ./prepaid.sh upgrade        拉了新代码以后升级：先备份，再构建、迁移数据库、重启
#   ./prepaid.sh status         看各服务是否正常、最近一次备份
#   ./prepaid.sh backup         马上备份一次
#   ./prepaid.sh drill [备份]   恢复演练：把备份恢复到临时库核对，不碰正在用的库
#   ./prepaid.sh restore <备份|latest>   用备份覆盖正在用的库（真出事时才用）
#   ./prepaid.sh logs [服务]    看日志（api / web / backup / postgres）
#
# 详细说明见 deploy/README.md。
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
# 这台服务器自己的调整（比如改端口）写在 docker-compose.override.yml，不进仓库。
if [ -f docker-compose.override.yml ]; then
  COMPOSE+=(-f docker-compose.override.yml)
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

env_value() {
  # 读 .env 里某一项（不 source，免得值里的特殊字符被 shell 解释）。
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)
  echo "${line#*=}"
}

set_env_value() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  if grep -qE "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" > "$tmp"
  else
    cp "$ENV_FILE" "$tmp"
    echo "$key=$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

need_docker() {
  command -v docker >/dev/null 2>&1 || die "没有装 Docker。Ubuntu：sudo apt-get install -y docker.io docker-compose-v2（见 deploy/README.md 第 2 步）"
  docker compose version >/dev/null 2>&1 || die "没有 docker compose。Ubuntu：sudo apt-get install -y docker-compose-v2"
  docker info >/dev/null 2>&1 || die "连不上 Docker（没启动，或者当前用户没有权限：用 sudo 运行）"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp env.example "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    say "已生成 deploy/.env，请先填好域名、微信、e签宝、对象存储，再运行一次 ./prepaid.sh install"
    exit 0
  fi
  chmod 600 "$ENV_FILE"
  if [ -z "$(env_value POSTGRES_PASSWORD)" ]; then
    set_env_value POSTGRES_PASSWORD "$(openssl rand -hex 24)"
    echo "已生成数据库密码（写在 deploy/.env）"
  fi
  if [ -z "$(env_value JWT_SECRET)" ]; then
    set_env_value JWT_SECRET "$(openssl rand -hex 32)"
    echo "已生成登录密钥（写在 deploy/.env）"
  fi
}

check_env() {
  local problems=() value
  for key in API_DOMAIN ADMIN_DOMAIN; do
    value=$(env_value "$key")
    if [ -z "$value" ] || [[ "$value" == *example.com ]]; then
      problems+=("$key 还没填（要填已备案、已解析到这台服务器的域名）")
    elif [[ "$value" == *://* || "$value" == */* ]]; then
      problems+=("$key 只写域名，不要带 https:// 和 /")
    fi
  done
  [ -n "$(env_value ACME_EMAIL)" ] || problems+=("ACME_EMAIL 还没填（申请 HTTPS 证书用）")
  [[ "$(env_value POSTGRES_PASSWORD)" =~ ^[A-Za-z0-9]+$ ]] || problems+=("POSTGRES_PASSWORD 只能是字母和数字")
  [ "${#problems[@]}" -eq 0 ] || die "deploy/.env 要改一下：$(printf '\n  - %s' "${problems[@]}")"

  [ -n "$(env_value WECHAT_MEMBER_APPID)" ] || echo "提醒：WECHAT_MEMBER_APPID / SECRET 没填，小程序登录不了（可以先装，填好后 ./prepaid.sh upgrade）"
  [ -n "$(env_value ESIGN_APP_ID)" ] || echo "提醒：ESIGN_APP_ID / SECRET 没填，开单签合同用不了"
  if [ -z "$(env_value S3_ENDPOINT)" ] || [ -z "$(env_value S3_BUCKET)" ]; then
    echo "提醒：对象存储没配，合同 PDF 和每日备份都只存在这台服务器上。服务器坏了就没了，正式营业前一定要配上"
  fi
  [ -n "$(env_value BACKUP_PASSPHRASE)" ] || echo "提醒：BACKUP_PASSPHRASE 没设，备份不加密（备份里有会员手机号）"
  if [ "$(env_value ESIGN_PRODUCTION_ENABLED)" = "true" ]; then
    echo "注意：ESIGN_PRODUCTION_ENABLED=true，会发起正式的电子合同（收费）"
  fi
}

wait_healthy() {
  local service="$1" tries=60 state
  printf '等 %s 启动' "$service"
  while [ "$tries" -gt 0 ]; do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$("${COMPOSE[@]}" ps -q "$service")" 2>/dev/null || echo starting)
    if [ "$state" = "healthy" ] || [ "$state" = "running" ]; then
      echo " 好了"
      return 0
    fi
    printf '.'
    sleep 3
    tries=$((tries - 1))
  done
  echo
  "${COMPOSE[@]}" logs --tail 50 "$service" || true
  die "$service 没有正常启动，上面是最近的日志"
}

build_and_start() {
  say "构建镜像（第一次要下载依赖，几分钟到十几分钟）"
  "${COMPOSE[@]}" --profile tools build
  say "启动数据库"
  "${COMPOSE[@]}" up -d postgres
  wait_healthy postgres
  say "数据库迁移"
  "${COMPOSE[@]}" --profile tools run --rm migrate
  say "启动接口、商家后台和每日备份"
  "${COMPOSE[@]}" up -d api web backup
  wait_healthy api
}

cmd_install() {
  need_docker
  ensure_env
  check_env
  build_and_start
  local api admin
  api=$(env_value API_DOMAIN)
  admin=$(env_value ADMIN_DOMAIN)
  say "装好了"
  cat <<EOF
  商家后台：https://$admin
  接口：    https://$api/health 应该显示 "ok":true 和 "db":"up"
  （HTTPS 证书第一次申请要一两分钟；打不开先看 ./prepaid.sh logs web）

接下来：
  1. 还没建公司的话：./prepaid.sh init-company
  2. 小程序后台「开发管理 → 服务器域名」：request 合法域名填 https://$api
  3. 小程序代码 apps/member-mp/utils/config.ts 里 trial / release 填 https://$api，再上传
  4. 马上备份一次并做恢复演练：./prepaid.sh backup && ./prepaid.sh drill
EOF
}

cmd_init_company() {
  need_docker
  [ -f "$ENV_FILE" ] || die "还没安装，先 ./prepaid.sh install"
  local org store phone name
  read -r -p "公司名称（以营业执照为准）：" org
  read -r -p "第一家门店名称：" store
  read -r -p "超级管理员手机号：" phone
  read -r -p "超级管理员称呼（例如 坤总）：" name
  [ -n "$org" ] && [ -n "$store" ] && [ -n "$phone" ] && [ -n "$name" ] || die "四项都要填"
  "${COMPOSE[@]}" run --rm --no-deps -e ORG_NAME="$org" -e STORE_NAME="$store" -e ADMIN_PHONE="$phone" -e ADMIN_NAME="$name" \
    api node dist/cli/init-company.js
}

cmd_upgrade() {
  need_docker
  [ -f "$ENV_FILE" ] || die "还没安装，先 ./prepaid.sh install"
  ensure_env
  check_env
  if [ -n "$("${COMPOSE[@]}" ps -q postgres 2>/dev/null)" ]; then
    say "升级前先备份一次"
    "${COMPOSE[@]}" up -d backup
    "${COMPOSE[@]}" exec -T backup /usr/local/bin/backup.sh || die "备份失败，没有升级。先看 ./prepaid.sh logs backup"
  fi
  build_and_start
  say "升级完成"
}

cmd_status() {
  need_docker
  "${COMPOSE[@]}" ps
  echo
  if "${COMPOSE[@]}" exec -T backup sh -c 'test -f /backups/last-success' 2>/dev/null; then
    echo "最近一次成功备份："
    "${COMPOSE[@]}" exec -T backup cat /backups/last-success
  else
    echo "还没有成功的备份。跑一次：./prepaid.sh backup"
  fi
  if "${COMPOSE[@]}" exec -T backup sh -c 'test -f /backups/last-failure' 2>/dev/null; then
    echo
    echo "最近一次备份失败了："
    "${COMPOSE[@]}" exec -T backup cat /backups/last-failure
  fi
}

cmd_backup() {
  need_docker
  "${COMPOSE[@]}" exec -T backup /usr/local/bin/backup.sh
}

cmd_drill() {
  need_docker
  "${COMPOSE[@]}" exec -T backup /usr/local/bin/restore-drill.sh "${1:-latest}"
}

cmd_restore() {
  need_docker
  local which="${1:-}" answer
  [ -n "$which" ] || die "要指定用哪份备份：./prepaid.sh restore latest，或者备份文件名（./prepaid.sh status 能看到最近一份）"
  say "用备份 $which 覆盖正在用的数据库"
  echo "恢复期间接口和商家后台会停掉。恢复前会自动另存一份当前的库。"
  echo "备份之后发生的充值、消费都会没有，需要按门店的纸质记录补记。"
  read -r -p "确定要恢复，请输入「确认恢复」：" answer
  [ "$answer" = "确认恢复" ] || die "没有恢复"
  "${COMPOSE[@]}" stop api web
  if ! "${COMPOSE[@]}" run --rm --no-deps -e CONFIRM_RESTORE=yes -v prepaid_storage:/restore-storage backup \
    /usr/local/bin/restore.sh "$which"; then
    "${COMPOSE[@]}" start api web
    die "恢复失败，接口已重新启动。上面有原因"
  fi
  "${COMPOSE[@]}" up -d api web
  wait_healthy api
  say "恢复完成，接口已重新启动"
}

cmd_logs() {
  need_docker
  "${COMPOSE[@]}" logs --tail 200 -f "${1:-api}"
}

case "${1:-}" in
  install) cmd_install ;;
  init-company) cmd_init_company ;;
  upgrade) cmd_upgrade ;;
  status) cmd_status ;;
  backup) cmd_backup ;;
  drill) shift; cmd_drill "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
