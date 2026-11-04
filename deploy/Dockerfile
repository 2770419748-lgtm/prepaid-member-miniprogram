# syntax=docker/dockerfile:1
#
# 正式环境镜像，一个文件分几个目标（docker-compose.yml 里按 target 用）：
#   api      接口（node dist/main.js）
#   migrate  上线 / 升级时跑一次数据库迁移（prisma migrate deploy），跑完就退出
#   web      Caddy：商家后台静态页 + 接口反向代理 + 自动 HTTPS
#   backup   每天备份数据库（pg_dump）和本机合同文件，传到对象存储，留 30 天
#
# 由 deploy/prepaid.sh 构建（install / upgrade 时），不用手动 docker build。
# 服务器在国内时，deploy/.env 里的 NPM_REGISTRY、APK_MIRROR、PRISMA_ENGINES_MIRROR 换成国内镜像。

ARG NODE_IMAGE=node:20-alpine
ARG POSTGRES_IMAGE=postgres:16-alpine
ARG CADDY_IMAGE=caddy:2-alpine

# ---------- 依赖和编译（只在构建时用） ----------
FROM ${NODE_IMAGE} AS build
ARG APK_MIRROR=
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=
ENV CI=true \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR} \
    PRISMA_HIDE_UPDATE_MESSAGE=1
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org#https://${APK_MIRROR}#g" /etc/apk/repositories; fi \
 && apk add --no-cache openssl \
 && npm install -g pnpm@10.33.4 \
 && pnpm config set registry "${NPM_REGISTRY}"
WORKDIR /src
# 先只拷依赖清单，源码改了也能复用这一层的下载缓存。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/admin-web apps/admin-web
# 小程序不进镜像，只要它的依赖清单让工作区和锁文件对得上。
COPY apps/member-mp/package.json apps/member-mp/package.json
RUN pnpm install --offline --frozen-lockfile --filter api... --filter admin-web... \
 && pnpm --filter shared build \
 && pnpm --filter api exec prisma generate \
 && pnpm --filter api build
# 接口运行只要生产依赖：单独导出一份，再把生成好的 Prisma Client 和编译结果放进去。
RUN pnpm --filter api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cd /out && /src/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ---------- 商家后台页面 ----------
FROM build AS web-build
# 商家后台把接口地址编进页面，所以要在构建时给出接口网址。
ARG API_ORIGIN
RUN test -n "${API_ORIGIN}" || (echo "缺少 API_ORIGIN（接口网址，例如 https://api.example.com）" >&2; exit 1)
RUN cd apps/admin-web && VITE_API_BASE="${API_ORIGIN}" pnpm build

# ---------- 数据库迁移 ----------
FROM build AS migrate
WORKDIR /src/apps/api
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------- 接口 ----------
FROM ${NODE_IMAGE} AS api
ARG APK_MIRROR=
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org#https://${APK_MIRROR}#g" /etc/apk/repositories; fi \
 && apk add --no-cache openssl tzdata \
 && mkdir -p /data/storage && chown node:node /data/storage
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    API_PORT=3000 \
    STORAGE_LOCAL_DIR=/data/storage
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]

# ---------- 商家后台 + HTTPS ----------
FROM ${CADDY_IMAGE} AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /src/apps/admin-web/dist /srv/admin

# ---------- 每日备份 ----------
FROM ${POSTGRES_IMAGE} AS backup
ARG APK_MIRROR=
RUN if [ -n "$APK_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org#https://${APK_MIRROR}#g" /etc/apk/repositories; fi \
 && apk add --no-cache rclone openssl tzdata
ENV TZ=Asia/Shanghai
COPY deploy/backup/*.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
HEALTHCHECK --interval=10m --timeout=10s --start-period=1m --retries=1 CMD /usr/local/bin/healthcheck.sh
ENTRYPOINT []
CMD ["/usr/local/bin/schedule.sh"]
