# 正式环境部署包

一台云服务器上跑全部服务：数据库、接口、商家后台（自动 HTTPS）和每日备份。按下面的步骤，从买好服务器到能用大约一小时，大部分时间在等下载和证书。

| 服务 | 做什么 | 对外 |
| --- | --- | --- |
| `postgres` | 数据库（PostgreSQL 16），数据在 docker 卷 `prepaid_pgdata` | 不对外 |
| `api` | 接口。小程序、商家后台、e签宝 回调都走它 | 经 `web` 转发 |
| `web` | Caddy：商家后台网页 + 接口反向代理，自动申请和续期 HTTPS 证书 | 80、443 |
| `backup` | 每天定时备份数据库和合同文件，传到对象存储，留 30 天 | 不对外 |
| `migrate` | 升级时跑一次数据库迁移，跑完就退出 | — |

所有操作都用 `deploy/prepaid.sh`，不用记 docker 命令。

## 1. 准备（都要用浩鑫通讯的主体）

- **云服务器**：阿里云 ECS 2 核 4G、系统盘 40G 以上，系统选 Ubuntu 22.04 或 24.04，地域成都。安全组放行 22（SSH）、80、443。
- **域名 + ICP 备案**：一个公司域名，建两个子域名解析到服务器公网 IP：`api.<域名>`（接口）和 `admin.<域名>`（商家后台）。国内服务器的域名不备案，80/443 会被拦。
- **对象存储 OSS**：建一个**私有** Bucket（地域和服务器一致），再建一个 RAM 子账号，只给这个 Bucket 的读写权限，拿它的 AccessKey。合同 PDF 和每日备份都放这里。
- **小程序 AppID 和 AppSecret**（会员和员工共用一个小程序）、**e签宝 AppID 和 Secret**。

## 2. 装 Docker（Ubuntu）

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git openssl
sudo systemctl enable --now docker
```

国内服务器拉 Docker Hub 的镜像（`node`、`postgres`、`caddy`）经常很慢或失败。阿里云 ECS 可以用阿里云的镜像加速器：控制台「容器镜像服务 → 镜像工具 → 镜像加速器」里有一个专属地址，写进 `/etc/docker/daemon.json`：

```json
{ "registry-mirrors": ["https://<你的专属地址>.mirror.aliyuncs.com"] }
```

然后 `sudo systemctl restart docker`。（加速器能不能拉到最新镜像以阿里云当时的政策为准；拉不下来时把报错发给开发。）

## 3. 拿代码、填配置、安装

```bash
git clone https://github.com/2770419748-lgtm/prepaid-member-miniprogram.git
cd prepaid-member-miniprogram/deploy
sudo ./prepaid.sh install      # 第一次运行只生成 deploy/.env，然后停下
nano .env                      # 按里面的说明填域名、邮箱、微信、e签宝、OSS、备份口令
sudo ./prepaid.sh install      # 再运行一次：生成密钥、构建、建库、启动
```

仓库如果改成了私有，`git clone` 要用有权限的账号（GitHub 个人访问令牌或部署密钥）。

`deploy/.env` 里有全部密钥，只放在服务器上：不进仓库、不发群、不截图。数据库密码和登录密钥由脚本自动生成，**生成后不要改**。`BACKUP_PASSPHRASE`（备份加密口令）自己定一个，**另外存一份**（比如密码管理器），丢了口令备份就打不开。

装好后：

```bash
sudo ./prepaid.sh init-company   # 输入公司名称、第一家门店、超级管理员手机号和称呼，打印一次初始密码
```

用这个手机号和初始密码登录 `https://admin.<域名>`，按提示改密码，然后在后台建其余门店、开员工账号。门店多的话用「门店管理 → 批量导入」一次传一张 Excel 表（先点「下载门店表格」照着填，第一家店同名会补全资料）。

## 4. 小程序那边

1. 微信公众平台「开发管理 → 开发设置 → 服务器域名」：request、uploadFile、downloadFile 三个合法域名都填 `https://api.<域名>`（开单上传协议单照片、查看照片要用后两个）。
   「设置 → 服务内容声明 → 用户隐私保护指引」里勾选「选中的照片或视频」和「摄像头」，用途写「门店开单时拍照上传顾客签字的会员协议单」。
2. `apps/member-mp/utils/config.ts` 里 `trial` 和 `release` 填 `https://api.<域名>`，用微信开发者工具上传。
3. 提审前在商家后台「门店与员工 → 小程序审核入口」打开审核体验（见 [docs/backend/review-demo.md](../docs/backend/review-demo.md)）。

## 5. 备份和恢复

- **每天自动备份**：每天 `BACKUP_TIME`（默认北京时间 03:30）把数据库（`pg_dump`）和本机合同文件打成一个包，设了口令就加密（AES-256），传到 OSS 的 `db-backups/` 下，OSS 上留 30 天、服务器本机再留 7 天。上传后核对大小，失败了第二天照常再跑。
- **看备份状态**：`sudo ./prepaid.sh status` 显示最近一次成功和失败的备份。超过 26 小时没成功备份，`backup` 服务会显示 `unhealthy`。
- **马上备份一次**：`sudo ./prepaid.sh backup`（升级前脚本会自动备份一次）。
- **恢复演练**（上线前必须做一次，之后建议每月一次）：`sudo ./prepaid.sh drill`。把 OSS 上最新的备份下载下来，恢复到一个临时库，核对各表行数、每张卡余额等于它所有流水加减的结果、合同文件包能打开，然后删掉临时库。不碰正在用的库，营业时间也能跑。也可以指定某一份：`sudo ./prepaid.sh drill prepaid-20261105-033000.tar.enc`。
- **真出事时恢复**：`sudo ./prepaid.sh restore latest`（或指定备份文件名）。要输入「确认恢复」；会先停接口、另存一份当前的库（`before-restore-*.dump`，本机留 7 天；恢复错了用 `sudo ./prepaid.sh restore before-restore-<时间>.dump` 找回），再用备份覆盖、核对余额、重启。**备份之后的充值和消费会丢**，要按门店的纸质记录补记。

## 6. 升级

```bash
cd prepaid-member-miniprogram
git pull
cd deploy && sudo ./prepaid.sh upgrade
```

先自动备份一次，再构建、跑数据库迁移、重启。迁移只做加表加字段这类改动；万一失败，接口不会用新代码启动，按提示看日志。

## 7. 排查

- `sudo ./prepaid.sh status`：各服务状态和最近一次备份。
- `sudo ./prepaid.sh logs api`（或 `web`、`backup`、`postgres`）：看日志，Ctrl+C 退出。
- 打不开 HTTPS：多半是域名没解析到这台服务器、没备案、或者安全组没放行 80/443，看 `logs web`。
- 接口没起来：看 `logs api`，常见是 `.env` 里某一项写错（启动时会写明哪一项）。

## 8. 安全要点

- 只开 22、80、443；数据库和接口端口不对外。
- 正式环境接口不开 `/docs`，跨域只认 `https://<ADMIN_DOMAIN>`，微信假手机号登录强制关闭，e签宝 正式签署开关默认关（`ESIGN_PRODUCTION_ENABLED=false`）。
- OSS Bucket 设私有，AccessKey 用只能读写这个 Bucket 的子账号。
- 本目录在开发沙箱里实测过：从空服务器安装、建公司、登录后台、备份上传到 S3 兼容存储（含上传失败的报警、30 天前的旧备份自动删除）、恢复演练、真恢复、用另存的库找回，以及升级。加密备份的加密和解密单独测过。阿里云 OSS 本身没有实测，第一次上线时 `sudo ./prepaid.sh backup && sudo ./prepaid.sh drill` 跑通就算验证了。
