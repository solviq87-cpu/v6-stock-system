# V6 发布说明（2026-11-04）

- 基于 `stock-dashboard_refactored_ui_strategy_v5_visual_20261102.zip` 继续迭代，保留原业务架构。
- 修正策略卡片守门测试的检查目标：卡片日期字段消费逻辑在 `public/assets/app.js`，不是 `public/index.html`。
- 同步服务端与移动端 Service Worker 版本号为 `20261104aa`；桌面端静态资源增加版本查询参数，避免旧缓存。
- 新增 `AI_DATA_SOURCE_HANDOFF.md`，明确后续真实行情接口接入边界、标准化字段与验收清单。
- 真实行情接口未在本次版本接通；本次不把外部供应商数据验证失败冒充为代码测试通过。
