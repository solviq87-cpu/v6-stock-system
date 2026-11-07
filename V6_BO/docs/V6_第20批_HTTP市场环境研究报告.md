# V6 第20批：市场环境研究接入HTTP服务

基线：V6_Unified_Observed_Regime_20261105.zip。

新增 POST /api/research/observed-regime，要求开发者身份验证、1MB请求上限、最多6000条股票快照；复用 classifyObservedMarket 的来源/日期/覆盖率/评分验证；不自动改写旧策略评分。响应标明 verifiedLive:false，防止用户提交的快照被误认为已经核实的实时行情。

修改：server.js；新增 observed-regime-http-route.test.js（三项静态路由安全/兼容测试）。
完整 node --test tests/*.test.js：153/153 通过，46个测试文件。该测试集不构成生产环境的联网端到端验证；本批没有实际启动外部行情提供商进行验收。
原始策略条件、14条规则、权重、阈值未改动。

后续：接入经过验证的真实行情提供商和有来源的评分，添加独立HTTP端到端授权/拒绝测试，接入前端展示；A/B/D/E/F组剩余任务仍需逐项验收。
