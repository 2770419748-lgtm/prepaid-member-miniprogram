# M4 · e签宝沙箱 — 后端实现说明

> **协作：** 实现方为**后端开发（本助手）**，用 Cursor **云端写码（Cloud Agent）** 改仓；**不交给 Claude Code**。每阶段开 PR，链接交 **开发部 → 总经理 → 请坤总确认** 后再合入；**禁止**自行 merge / 部署 / 改生产。公开内容不得出现具体项目名；称呼**坤总**。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram  
> **落点：** `apps/api` · `EsignModule`（M0 已有配置骨架）  
> **预估：** 约 10 人天 · **依赖 M2**；**企业章正式能力等 M6**  
> **硬约束对齐：** `docs/tech/tech-final.md` · `docs/tasks/m0-kickoff.md`（定稿第 7 节 · M0 `ESIGN_PRODUCTION_ENABLED` · `docs/esign-switch.md`）

---

## 1. 目标与非目标

### 目标

1. 沙箱联调 e签宝：模板绑定、选会员发起、签署状态同步、PDF 归档对象存储  
2. 支持签署方模型：**会员个人签 + 商家企业章**（沙箱按 e签宝文档**模拟**；正式企业章能力 **M6**）  
3. `SignFlow.env`：`SANDBOX` | `PRODUCTION`；**仅当** `ESIGN_PRODUCTION_ENABLED=true` 才允许走正式密钥 / `PRODUCTION`  
4. 默认关闭正式签署；**入职前不可开**  
5. 为小程序提供签署 URL / 状态查询；**H5 内嵌 + 刷脸公证签中间页由前端配合**（后端提供 URL、回调、配置说明）

### 非目标

- 打开正式签署、配置生产企业章（→ M6）  
- 实现小程序 UI / 公证签中间页前端（前端任务；本说明只定义后端契约与回调）  
- 腾讯电子签并行对接  
- 微信支付  
- 自行 merge / 部署 / 改生产（须坤总确认）

---

## 2. 前置依赖

等 M0 落地后在现有 schema 上扩展；若冲突以能支撑下列实体与开关为准。

- [ ] M0：`EsignConfigModule`、`ESIGN_PRODUCTION_ENABLED=false`、flag 单测、S3/MinIO env 占位  
- [ ] M0 实体：`BenefitPlan`、`ContractTemplate`、`SignFlow`  
- [ ] M1：店员鉴权（已合入）  
- [ ] M2：Member 可查询（发起签署需会员；已合入）  
- [ ] e签宝开放平台**沙箱**应用凭据（坤总本地 `.env`，不进仓）

---

## 3. 数据模型要点

### BenefitPlan

| 字段 | 说明 |
| --- | --- |
| orgId, title, contentJson?, status | 权益文案/配置（可调） |

### ContractTemplate

| 字段 | 说明 |
| --- | --- |
| orgId | |
| benefitPlanId | 可选关联 |
| **esignTemplateId** | e签宝模板 ID |
| name, status | |

### SignFlow

| 字段 | 说明 |
| --- | --- |
| orgId, memberId, templateId | |
| **esignFlowId** | 第三方流程 ID |
| **status** | 如 DRAFT/PENDING/SIGNED/FAILED/CANCELLED（可调，与 e签宝状态映射表写清） |
| **signUrl** | 会员签署 H5 链接 |
| **pdfObjectKey** / pdf 引用 | 归档对象存储 key（M0 字段名 `pdfObjectKey`；对外 API 可暴露 `pdfUrl` 签名链） |
| **env** | **`SANDBOX` \| `PRODUCTION`** |
| createdAt / updatedAt | |

---

## 4. 权限矩阵（本模块）

| 角色 | 能力 |
| --- | --- |
| `SUPER_ADMIN` | 模板 CRUD、任意会员发起、查全部流程 |
| `STORE_MANAGER` / `STAFF` | 对本店相关会员发起签署、查本范围流程（范围规则可调：按开卡门店或全店员可见本公司会员——**建议本版：店员可对本 org 会员发起，操作记 audit**） |
| 会员 | 仅自己的 SignFlow 列表 / 详情 / 取 signUrl |

---

## 5. API 清单

| 方法 | 路径 | 鉴权 | 请求/响应要点 |
| --- | --- | --- | --- |
| POST | `/benefit-plans` | 超管 | 创建权益方案 |
| GET | `/benefit-plans` | 店员 | 列表 |
| POST | `/contract-templates` | 超管 | `esignTemplateId`, `name`, `benefitPlanId?` |
| GET | `/contract-templates` | 店员 | 列表 |
| POST | `/sign-flows` | 店员 | `memberId`, `templateId` → 调 e签宝沙箱创建流程；写 `SignFlow(env=SANDBOX\|PRODUCTION按开关)`；返回 `signUrl` |
| GET | `/sign-flows` | 店员范围 / 会员自己 | 筛选 status、memberId |
| GET | `/sign-flows/:id` | 有权 | 含 status、signUrl、pdf 可用标识 |
| POST | `/sign-flows/:id/refresh` | 店员或系统 | 主动轮询 e签宝状态并回写 |
| POST | `/webhooks/esign` | 签名校验（e签宝回调） | 验签 → 更新状态 → 若完成则下载 PDF → 上传对象存储 → 写 pdfObjectKey |
| GET | `/members/me/sign-flows` | 会员 | 自己的列表 |

**开关硬逻辑（服务内）：**

```text
if env==PRODUCTION || useProdCredentials:
  assert ESIGN_PRODUCTION_ENABLED === true
else:
  只使用沙箱 host / 沙箱密钥（ESIGN_API_HOST 默认 smlopenapi）
```

启动时已有日志打印开关；发起签署前再次 `assertSandboxUnlessEnabled()`。

---

## 6. 业务流程

```
后台绑模板（ContractTemplate.esignTemplateId）
  → 选会员发起 POST /sign-flows
  → 后端调 e签宝（沙箱）创建流程，存 esignFlowId、signUrl、env
  → 会员小程序打开 signUrl（H5 内嵌）；刷脸跳转公证签中间页（前端）
  → e签宝回调 或 后端轮询 refresh
  → 签署完成：拉 PDF → 对象存储 → 更新 status + pdfObjectKey
```

企业章：沙箱按文档配置模拟章；**正式企业章与生产密钥切换属 M6**，本里程碑不得把 `ESIGN_PRODUCTION_ENABLED` 设为 true 提交进仓。

---

## 7. 业务规则与硬约束

1. **默认正式关**；入职前不可开；PR / `.env.example` 保持 `false`。  
2. `SignFlow.env` 与真实调用环境一致；禁止 `env=SANDBOX` 却打正式 host。  
3. 回调验签失败 → 401/403，不更新库。  
4. PDF 不进 Git；只存对象存储 key。  
5. 公开文档无具体项目名；密钥不进仓。  
6. 前端配合点写进 `docs/` 短文：业务域名、webview、刷脸中间页回跳参数（可引用 e签宝公开文档链接）。

---

## 8. 云端开 PR 验收清单

- [ ] `ESIGN_PRODUCTION_ENABLED=false` 时发起流程 `env=SANDBOX`，且走沙箱 host  
- [ ] 开关 false 时尝试强制生产凭证 / PRODUCTION → 被拒绝（单测覆盖）  
- [ ] 模板绑定 + 发起 + 回调（或 refresh）状态回写成功  
- [ ] 签署完成 PDF 进入对象存储，`pdfObjectKey` 有值  
- [ ] 会员只能看自己的 sign flows  
- [ ] 无正式企业章生产开通步骤被做成默认路径  
- [ ] `.env.example` 仍为 false；无真实 ESIGN secret 进仓  
- [ ] 已开 PR（建议 `feat/m4-esign-sandbox`），**未自行 merge**；PR 链接已交开发部请坤总确认

---

## 9. 测试建议

- 单测：`EsignConfigService.assertSandboxUnlessEnabled`  
- Mock e签宝 HTTP：创建流程、回调 payload、下载 PDF  
- 契约：webhook 验签错误包  
- 手工：沙箱账号端到端（坤总本地凭据）

---

## 10. 后端直接实现步骤

1. 读 M0 `EsignConfigModule` / `docs/esign-switch.md`；补全客户端（沙箱）  
2. BenefitPlan + ContractTemplate CRUD  
3. 创建 SignFlow（调沙箱 API）+ 权限  
4. Webhook + refresh + 状态机映射  
5. PDF 下载与 S3/MinIO 上传  
6. 会员查询 API；文档：前端 H5/刷脸配合说明  
7. 开关单测强化 → 自检 → 用 Cloud Agent 开 PR → **PR 链接交开发部，等坤总确认后再合入**（禁止自行 merge / 部署）

---

## 11. 合入须坤总确认

开 PR（如 `feat/m4-esign-sandbox`）；确认开关默认 false、无生产密钥；将 PR 链接交开发部，由开发部转总经理请**坤总确认**后再合入。企业章正式能力明确留待 **M6**。禁止自行 merge / 部署 / 改生产。
