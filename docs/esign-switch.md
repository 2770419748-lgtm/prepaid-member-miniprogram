# 电子签开关 `esign.production.enabled`

电子签供应商为 e签宝。本里程碑只做配置与校验骨架，不发起真实签署。

## 沙箱与正式

| | 沙箱 | 正式 |
| --- | --- | --- |
| 用途 | 联调、默认环境 | 对外正式签署、正式密钥与计费 |
| 网关 | `https://smlopenapi.esign.cn`（`ESIGN_API_HOST` 默认值） | 主体就绪后由运维改正式网关 |
| 何时允许 | 始终是默认路径 | 仅当总开关为 true |

配置项 `esign.production.enabled` 对应环境变量 `ESIGN_PRODUCTION_ENABLED`。

- 未设置、空字符串、`false` / `0` / `no` / `off`：视为 **false**。
- 只有 `true` / `1` / `yes` / `on` 视为 **true**。
- 仓库样例与代码默认都是 **false**。

启动日志会打印当前值，例如 `esign.production.enabled=false`。`GET /health` 返回 `esignProductionEnabled`。

`EsignConfigService.assertSandboxUnlessEnabled(target)`：

- `SANDBOX`（默认）：开关关闭时允许，调用方只能打沙箱。
- `PRODUCTION` 且开关为 false：抛错，拒绝正式签署。

`SignFlow.env` 默认 `SANDBOX`。

## 主体切换时的运维步骤（占位）

详细切换清单属后续里程碑。主体与企业章就绪后，由运维按下面顺序操作，不要把密钥写入仓库：

1. 确认企业主体与企业章已经可用。
2. 在运行环境注入正式 `ESIGN_APP_ID`、`ESIGN_APP_SECRET`（仅环境变量或密钥管理）。
3. 将 `ESIGN_API_HOST` 改为正式网关。
4. 显式设置 `ESIGN_PRODUCTION_ENABLED=true`。
5. 重启 API，确认日志为 `esign.production.enabled=true`，且 `/health` 的 `esignProductionEnabled` 为 `true`。
6. 用一笔受控签署验证正式环境，再放开业务入口。

开关保持 false 时，不得配置正式密钥去打正式网关，也不得把签署环境写成 `PRODUCTION`。
