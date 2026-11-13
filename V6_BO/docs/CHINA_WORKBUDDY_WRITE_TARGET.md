# V6 国内写入／部署目标（交接必读）

> 2026-11-13 用户明确覆盖此前目标；这项授权允许实现 GitHub 自动检测与更新，不是已部署证明。

## 当前唯一指定目标

- 主机：`https://af3c7822e6aafc135.app.workbuddy.host`。
- 官方管理／文档入口：`/console`；发布：`POST /api/publish`，JSON `{html,title?,author?}`。
- 每个请求都保留 `sharecode` 查询参数，值仅从私有凭据存储读取，禁止进入 Git、CI 日志、Issue、PR、截图或公开构建产物。
- 仓库：`solviq87-cpu/v6-stock-system`，默认/跟踪分支 `dev`。
- 用户要求自动检测 GitHub 新代码并更新；操作、CI 门禁与当前阻塞见 [自动更新操作](AUTO_UPDATE_WORKBUDDY_20261113.md)。

## 2026-11-13 实际只读核验

| 请求（均省略凭据值） | 实际结果 |
| --- | --- |
| `GET /`（带分享码） | 200，标题“天枢智策V6选股驾驶舱”，339959 bytes |
| `GET /api/ai/doc?id=ai`（带分享码） | 404 JSON，返回官方指引 |
| `GET /console`（带分享码） | 200，官方管理／发布说明 |
| `GET /api/site`（带分享码） | 200，`{ok,published,site:{title,author,at,html}}` |
| `GET /api/health`（带分享码） | 200 |
| `GET /api/health`（无分享码） | 403 |

`/api/ai/doc` 是旧文档路径，不是已验证的写入 endpoint；不得向它 POST 工程、配置或账本。官方说明核实的写入路径仅为 `/api/publish`。上表初始只读核验时尚未执行写入，不能把只读 200 当成生产部署证明。随后真实发布已写入该站，但首次大页面的 8 个汉字变为 21 个 U+FFFD，完整产物哈希校验失败；候选仍在线上，不能将这次写入记为成功发布。

损坏特征高度符合服务端或中间层逐分块错误解码 UTF-8；未取得服务端源码，不能进一步确认具体实现。修复将 JSON 请求体转换为纯 ASCII 的 Unicode 转义，JSON 解码后的 HTML 字节必须保持完全相同。恢复先用 `restore-legacy` 精确绑定当前实际 HTML 哈希和本目标原加密快照，再对成功 CI 的新 SHA 初始化并完整读回；禁止重新标记损坏页面或放宽断言。后续执行回执记录在对应修复 PR，参考配置保持默认未激活，不代表会话或完整后端已上线。

该站只托管单文件静态 HTML，不能执行 Node/Python，不能因此宣称 V6 完整后端、云端账户、持久化行情、定时采集或飞书主实例已上线。当前站点 HTML 与 `V6_BO/public/index.html`、`mobile.html` 锁定主页及 `V6_WEB/dist` 不同。保持用户当前界面、策略、模拟盘和风控代码；站点源与构建 provenance 见 `V6_WEB/workbuddy/`。禁止借旧 `_release_publish` 流程改版本或暂存脏代码覆盖当前站点。

## 接手、更新与恢复

1. 先读根 `AGENTS.md`、`V6_BO/AGENTS.md`、本文件、`integration/CHAT_HANDOFF.md` 与自动更新操作；代码以 GitHub `dev` 精确 SHA 为基线。
2. 从私有环境变量 `V6_WORKBUDDY_SHARECODE` 取分享码，只向当前指定 HTTPS 主机发送；不得硬编码、打印完整认证 URL 或猜其他接口。
3. 发布前确认精确分支头 SHA、该 SHA 的 V6 CI `verify` 和 `verify-web` 均成功，保存当前站点加密快照与私有审计记录。
4. 发布单文件 HTML 后核对 `/api/site` 的精确产物 SHA 标记和健康检查；失败停止，按已保存快照回滚并回读验证。不得将未验证发布写成成功。
5. 真实写入后才更新授权/部署事实；记录去敏源 SHA、产物哈希、回执、读回、恢复结果与真实桌面/手机验收。任何失败门禁都阻止继续自动发布。

## 配置与凭据边界

参考配置：`config/china-workbuddy-write-target.example.json`。`V6_CN_WRITE_ORIGIN` 可引用当前主机，`V6_CN_WRITE_DOC_PATH=/console`、`V6_CN_WRITE_ENDPOINT=/api/publish` 是已核实的路径；自动化使用 `V6_WORKBUDDY_SHARECODE` 私有 Secret。配置文件只保存变量名称，不保存任何实际分享码、token、个人持仓或成本。

当前 GitHub 集成对仓库 Actions Secret 公钥接口只读请求返回 403，无法代用户配置 Secret；禁止用工作流明文变量替代。完成一次私有 Secret 配置之前，长期自动更新未激活；绿色工作流也可能因为没有 Secret 而跳过发布，必须检查发布步骤的实际执行记录。

## 历史记录（禁止作为当前目标或备用）

2026-11-09 旧用户目标 `https://acd98a1c1a46e6ce4.app.workbuddy.host` 的 `/api/ai/doc?id=ai` 当时返回 `401 invalid or missing token`，未取得写入规范。此记录仅供审计；2026-11-13 用户新指令已覆盖旧主机，禁止自动回退或将历史 401/403 套用到新目标的带分享码文档读取结果。

后续只有用户明确改变目标才可修改当前主机，并同步根 `AGENTS.md`、`V6_BO/AGENTS.md`、根及 BO `README.md`、`RESTORE.md`、`integration/CHAT_HANDOFF.md`、配置与交接测试。
