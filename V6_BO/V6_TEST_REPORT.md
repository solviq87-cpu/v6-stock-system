# V6 本地验证报告

日期：2026-11-04  
基线：`stock-dashboard_refactored_ui_strategy_v5_visual_20261102.zip`

## 本轮修复
- 从 V5 基线恢复 V6 漏装的 `strategies/a-share-strategy-pack.json`，策略服务不再因文件缺失而启动失败。
- 修复 `DATA_CAP` 初始化时序：原常量位于文件约 12901 行，而启动期学习治理在约 4269 行调用链中读取容量，触发 TDZ。现将容量表前移到启动治理之前。
- 保留此前修复：策略卡片测试路径、模块联动测试根目录、版本号与静态资源缓存标记。
- 新增/保留 `AI_DATA_SOURCE_HANDOFF.md` 与 `V6_RELEASE_NOTES.md`；真实国内行情供应商仍未接入，模拟数据与真实接口边界按交接文档说明。

## 本轮实测结果

| 项目 | 结果 | 说明 |
|---|---:|---|
| `node --check server.js` | 通过 | 服务端语法检查 |
| `node --check public/assets/app.js` | 通过 | 前端脚本语法检查 |
| `node tests/strategy-service.smoke.js` | 通过 | `pass=true`，样例评分 81.62 |
| `node scripts/strategy-smoke.js` | 通过 | `ok=true`，样例评分 80.08，驱动 trend/momentum/breakout |
| `_test_strategy_cards.js` | 42 通过 / 0 失败 | 策略卡片守门 |
| `_test_routes_smoke.js` 静态部分 | 5 通过 / 0 失败 | 解析 92 个路由分支、检查 35 处权限令牌作用域 |
| `/api/lock/status` HTTP 实请求 | 200 | 本地服务启动后真实 GET，约 0.003 秒，返回合法 JSON |
| `_test_routes_smoke.js` 全量 HTTP 实跑 | 未完成 | 59 条 GET 路由遍历期间出现连接重置/拒绝；测试进程达到执行时限，不能标记全量通过 |
| `_test_http_diag.js` | 16 通过 / 1 失败 | 失败项为测试数据断言 `financial.season = 2026-09-30`，待核对数据日期口径 |
| `_test_module_linkage.js` | 未通过 | 自身守门汇总发现 8 个关联测试中 2 个红灯，需进一步拆出具体失败项 |
| 启动期 `DATA_CAP` TDZ | 已修复并复测 | 修复后启动日志不再出现 `Cannot access 'DATA_CAP' before initialization` |
| 国内真实行情接口 | 未验证 | 当前环境对新浪/东财请求未获得有效全市场数据；不能声称真实行情连通 |

## 运行环境说明
- HTTP 实跑使用本地离线 SDK stub，仅用于隔离云端 SDK 依赖、验证本地 HTTP 服务；stub 不打包进发布 ZIP，也不代表云端服务已连通。
- 当前运行环境未安装 `@tencent-ai/workbuddy-cloud-sdk` 正式依赖；正式部署按 README 安装依赖。
- 启动时行情源返回 0 条，故本轮只确认接口服务能启动及指定 GET 请求能返回，不把空行情当作真实行情通过。

## 尚未完成 / 不得宣称通过
1. HTTP 全路由 GET/POST 完整实跑与失败修复。
2. `_test_http_diag.js` 的日期口径失败项。
3. `_test_module_linkage.js` 中 2 个关联红灯。
4. 国内真实行情供应商连通性验证。
5. Windows 原生环境模块关联测试及完整发布环境回归。

## 安全处理
源码包不包含 `config.json`、设备访问凭据、持仓/模拟盘数据、线上同步令牌、cookie 和本机运行时缓存。首次运行时按 README 指引生成本地配置；不要把本机凭据复制进公开源码包。
