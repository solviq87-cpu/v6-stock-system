# ABCD统一集成｜C20原专项否决入口收口

父提交 `ca52a36dd25dc3fd9b8d3c56bbb494e7137bb38b`（#563），dev基线保持 `8c90f77f58f90d98d348a5d8c3d9bca4d0121928`。只处理原C20待审查探针，不引入#562任务5，不扩大原ABCD范围，不修改原策略权重、15秒、2倍毛赔率、预算、账户权限、持仓退出、通知、工作流或生产发布。

## 父候选正式回执
V6 CI run 46044210656：12/12作业；verify 140659278589 原生8017/8017，0失败0跳过；实际手机隐私回归、独立策略、完整服务冒烟通过。9视口浏览器 run 46044210663 成功，逐提交覆盖 run 46044210708 成功。父版本工作流证据不继承给本次新SHA。

## 原合同缺口
原独立审计脚本的五条探针中，四条已在C20上一批整改拦截；最后一条注入当前服务端权威卡 `riskAssessment={status:'blocked',canOpenRisk:false}` 仍到达隔离模拟买入回调。该探针不是已证明的生产可达性漏洞。

本次在原 currentDecisionAllows 内增加单向拒绝：当前服务端权威卡明确 blocked 或 canOpenRisk===false 则不进入原买入回调；无字段或正面意见不授予任何权利，仍经过原候选、原报价、原仓位和原账户限制。保留客户端字段白名单及已成交只读幂等重试。没有把C组 shadowOnly 报告接为交易许可或新增正式风控生产者。没有取消任何原测试或审计探针，原审计仍明示 formalContractApproved=false。

## 实际隔离复核
从精确父SHA读取原适配器、a-share-calendar、quote-observation-view、paper-fill-evidence、common-entry-risk、portfolio-risk-gate、decision-model、system-picks、原测试及原夹具。在 V8 隔离加载原源码（ESM导出做隔离加载适配、保留原规则；原observer的dateOk/sessions精确提取；未消费的digest/crypto/provenance依赖设为抛错桩），原node:test断言由隔离断言适配执行，不宣称原生Node全仓。
- 原17项加新增3项，修前19/20（明确否决反例失败），修后20/20。
- 原5个独立审计探针：修前4/5拒绝，修后5/5拒绝；未关闭探针数1→0。正常原卡与正面研究意见仍需通过原门禁，候选/报价/风险/新闻/客户端注入原限制均保持。
- 原买入回调仅哨兵计数，无账本写入、下单、外发或网络。审计报告中formalContractApproved仍为false：尚未认证生产者是否真实提供该字段、风险ID/证券/账户期次/配置/原报价绑定、事务锁内重验、其他原C共享合同。不能把五探针通过认定为九项完整合同签收。
- 新提交的原生CI及浏览器重新验收待回执，不能借用父版本8017通过或模拟真实行情。

正式复验：在 V6_BO 运行 `node --test tests/c-entry-veto-contract.test.js` 与 `node scripts/c-entry-veto-audit.js`，保留原全量与双端工作流。总管须依据原任务决定剩余合同签收及正式合并，未部署、未合并dev。
