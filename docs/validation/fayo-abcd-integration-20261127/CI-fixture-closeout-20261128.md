# ABCD统一集成｜原验收两处夹具修正

父提交 c1d21913d346fabdae1b80e7e47d397d56c27edc，PR #563，仅修复原ABCD候选验收失败。不纳入#562的任务5代码，不增加任务范围，不修改生产代码、工作流、风险收益阈值、15秒报价门禁、账户、策略或权限。

## 原正式失败
- V6 CI run 46032058510 / verify job 140618047394：8017项，8016通过、1失败、0跳过。dashboard-push-privacy.test.js:73 对缺失公开快照行取code失败。原测试用运行日期倒推快照日，可能落在周末并且查询时段不确定。
- V6 UI Browser Geometry run 46032058496 / job 140618047225：fayo-advanced-safety-browser-check.js:38，originalGateStatus 实际 blocked，预期 allowed。C20已明确要求原报价canTrade===true；浏览器隔离原始stock具有true，构造authorityQuotes时遗漏此字段。相同问题在本父提交中已由automatic-entry-preview.test.js等夹具补传原权限；生产paperAuthorityQuotes也已传递原权限。

## 修复及验证边界
- 隐私测试固定周日查询时点2026-11-22 10:00北京时间与周五快照2026-11-20 14:55北京时间；子进程仅冻结Date。其余真实HTTP、访问权限、隐私、快照来源及时点、禁止外部请求断言完全不改。本文件与历史已修正夹具（blob f11cedc2c19b008bd71b9e95ee26e393dd9576c1）逐字一致；不引入其所属分支其他功能。
- 浏览器测试仅将已有的原始stock.canTrade===true传入隔离authorityQuotes，和原生产投影一致。保留原allowed断言、原账户预演、现金持仓守恒及权限/防御/浏览器测试；不直接给缺少许可的原始行赋权。
- 本轮根据真实日志与源码定位并精确修正两份测试夹具。未在本地启动完整服务、浏览器或全仓；新SHA必须由正式GitHub CI重跑，不使用旧SHA成功结果代替。尚未核验的原C组共享合同、主线保护、真实授权及设备等保留原验收范围；不标记为已完成，不合并dev、不部署。
