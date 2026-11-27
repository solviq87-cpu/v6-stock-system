# 绯曜 FAYO D组｜股票报价来源类别与市场范围门禁 · 2026-11-27

## 任务与去重

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336；D04/D29/D53/D56/D77/D78 局部整改，不能视为这些任务整体验收。保留既有122条来源登记、全部策略、原用途和唯一发布机制。#431/#433 的独立验收头不变。已检查 #427 两页（159文件）、#430/#432/#410/#431/#433/#405 的文件清单，本融合模块及原血缘/测试未发生路径重叠。其余分支、全部历史任务与原任务编号映射由总管进一步核对。

## 实际缺陷和修改

旧 fuseMultiSourcePrices 只判断来源是否登记并且有明确原始上游，未限定股票报价数据类别。离线复现中 baostock 历史日K、World Bank 宏观序列、FRED 宏观统计等被包装成鲜活股票报价后可参与两票共识；FRED 甚至能在两个原生报价冲突时形成错误多数。

沿用现有 immutable sourceLineage 读取登记类别及市场，不信任请求自报类别。CN 的 a-share-quote / cn-multi-asset / cn-quote-execution 为研究比较候选；GLOBAL 的现有 itick-stock-quote.js 专用路线是显式例外。其他全球报价或逐笔候选在核实 A 股适用范围并完善目录前不投票。这个候选条件只核对目录类别，不证明接口实装、真实请求、授权、市场覆盖或数据真实性；iFinD、miniQMT 等候选仍不可据此自动启用。原数据目录、凭据、适配器、资金、公告及历史数据功能不作更改。

不适用来源保留原始诊断价格和时点，状态 incompatible-quote-source-class，publisherCandidate=false；新增 sourceDataClass、sourceMarket 和 incompatibleQuoteSourceCount。原 eligibleCount 保留旧形状/时间/身份诊断计数，真正可投票数以 cataloguedPublisherCandidates 为准。已登记同上游重复包装仍保持原保守否决，不因类别隔离绕过。原合并逻辑、阈值、前收校验、canTrade/canNotify=false、授权状态及15秒生产交易门禁不变。

## 实际验证（非 Node 全量）

用固定 GitHub blob 的原文件在隔离 V8 JavaScript 环境执行同步融合逻辑。实际加载完整122条登记及原目录 JSON、原 data-source-lineage、原 session 实现。未调用的公开探测/可选 iTick 网络依赖为抛错桩；使用同步 test/strict assert 的最小替代执行器（equal/deepEqual/ok/throws），不是 Node 内置测试运行器。原有测试中6个 async 回调未运行，不计通过、不伪称零跳过。提交的正式新增测试使用原生 node:test/node:assert/strict；远端完整 CI 待验。

原始文件 blob：
- multi-source-price-consensus.js: 5efc4b1e0606a9b3402e1be6f07440b2d6fcbd59
- data-source-lineage.js: 817048838ad9ba6abe02a1e308ac11a8bd695a98
- data-source-registry-2026.json: 460ff80ad5e80931ef6903b7855d64bf668854ab
- data-source-catalog.json: 33817eaee4ef039127b9624bbbc9ac9d3e74802d
- quote-dual-source-diagnostic.js: a065fbf31a9f1763efff6f397a687bf99f45240b
- multi-source-publisher-lineage.test.js: dcb86854503e7357ec4c426901e27157ce12d37c
- multi-source-price-consensus.test.js: 4a440b222bdefba6134743cf9a3a38d4458934e3

既有同步测试24/24修前修后均通过；新增7项测试修前全部失败（含一项新增诊断字段兼容断言），修后全部通过。合计修前24/31、7失败；修后31/31、0失败。另有6项既有异步测试未执行。反例覆盖非报价类路线、错误多数、自报类别篡改、全球市场类别不足、合法原研究比较、同源重复否决、有效双源隔离异常诊断。没有联网调用供应商、付费、取得新授权或生产变更。完整 Node 环境及全量回归尚未验证。

## 下游与总管协调

decisionCrosscheckGate（intelligence-research.js）消费 publisherCandidate/status，修后新生成报告自动剔除错误类别，但旧报告及其他消费方仍需在读入时按目录重新校验，禁止直接继承历史布尔字段。此共享风险/决策链路本批不改，交总管协调后复核旧报告、重复来源、跨模块证据与 UI 状态展示。quote-cross-check、AI、风险工作台的实际集成测试和5/20/60交易日真实观测均待验。

建议精确头运行：
node --test tests/fayo-d-quote-class-integrity.test.js tests/multi-source-publisher-lineage.test.js tests/multi-source-price-consensus.test.js tests/multi-source-calendar-gate.test.js tests/quote-nontrading-source-status.test.js
随后现有 npm run check、全量 npm test、双端、实际授权与联网验收。总管唯一最终集成和发布。回退仅撤销本隔离补丁，不覆盖原始数据、账本、目录、权限或历史证据。
