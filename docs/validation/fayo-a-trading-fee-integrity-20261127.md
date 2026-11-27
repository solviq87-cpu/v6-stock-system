# A组 · 累计交易费用及安全金额门禁 · 2026-11-27

## 基线与范围

- dev `0c45291d7156be8a1206f0bb272f3c719d5d2336`，源码 `V6_BO/src/core/trading-fees.js` 原 blob `1528cfe435c44fd27e4f918c6417a4c9156b02da`。#427 查阅点 `6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f` 159 个差异路径、#428—#438 当时各文件列表不含本批两个 JS 路径；已有总管候选修改 paper-application-service，合并后须验证其与本费用模块的实际消费。#428、#437保持独立。
- 对应 A 任务11/12/13/14、A-EX03/27/29，原49及原第四批07关联，均为局部整改证据。复用原费用引擎，不另建账户、风控或回测入口，不调整实际费率、税率、仓位、交易或推送权限。保留逐笔计费、同一委托同日同版本累计、跨日/版本分开、总费用一次舍入、生效表和已知时点。

## 复现与修复

原代码仅检查历史费用组件有限非负，历史 total 可不符合累计目标，产生负增量费用、重复最低佣金或错误冻结。缺少当日费用证据、日期/版本不明、重复 eventId、伪成交、金额/口径/舍入差异及超安全分范围未全部拒绝。

现在逐条核验同日同版本费用前缀，核对已提供的成交价量、实记费用、版本口径和组件；当日缺失费用/版本、非法或未来日期、重复身份、非成交夹带费用拒绝，已知不同日期或显式不同版本不重复计入本版本最低佣金。保留不带可选身份/价量的原最小计算器输入，只能验证已给证据，不能证明交易来源或完整事件集。金额及费用限制在安全分范围内；不声称全部资金引擎改为任意精度整数。合法历史不自动改写，不增加持久字段或迁移。

## 实测

隔离恢复精确原费用模块并逐字核验原 Git blob，Node v22.16.0。直接 Git DNS 失败，未取得完整最新工作树。命令：node --test V6_BO/tests/fayo-a-trading-fee-integrity.test.js；node --check 两JS文件；git diff --cached --check。

| 阶段 | 总数 | 通过 | 失败 | 跳过 | TAP SHA-256 |
|---|---:|---:|---:|---:|---|
| 原代码 + 14项新测试 |14|5|9|0|e8fa0f5ff1aebf607ee08b8586f63d174c1a40f30ae75a166be4b8235d8cd037|
| 修后 |14|14|0|0|61e45ec9681b66cbb5ac883ae428def106784a9fca5a46401d217c3d6371e4d7|

新源码与测试实测 blob 分别 `691b18702c51903b6429ba858b4a4d2b323059aa`、`504d3a97bd000c3aeeefd87f0a764e91544761ce`。两文件语法、暂存差异检查通过。固定种子314159，合法历史由原模块生成，原与最终新模块进行8000次深度输出比较，全部相同：两个费用范围×买卖方向×100配置×20次成交。不是8000个真实样本。差分输出SHA256 `506770d076675d9452d7105a91e9da942a6230e1b6cfe8df865ac5326d32c502`；脚本SHA256 `681e64a13de61a8d4c74da5aae05cb763260430b4b0e2cb4a00034767a80c8a9`。

差分复现：先将原基线文件放在 evidence/original-fees.cjs，再保存以下为 evidence/differential.cjs 并运行 node evidence/differential.cjs：

```js
const assert=require('node:assert/strict');const old=require('./original-fees.cjs');const newer=require('../V6_BO/src/core/trading-fees.js');
let seed=314159,checks=0;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);for(const scope of ['fill','order-day'])for(const side of ['buy','sell'])for(let k=0;k<100;k++){const policy={version:'diff',commissionScope:scope,minFee:k%3===0?5:0,feeBps:Math.floor(random()*10000)/100,sellTaxBps:Math.floor(random()*10000)/100,transferBps:Math.floor(random()*10000)/100};const priorFills=[];for(let i=0;i<20;i++){const quantity=1+Math.floor(random()*10000),price=(1+Math.floor(random()*100000))/1000,tradeDate='2026-11-05',args={policy,side,quantity,price,tradeDate,priorFills};const expected=old.tradingFees(args);assert.deepEqual(newer.tradingFees(args),expected);checks++;priorFills.push({eventId:String(i),type:'fill',quantity,price,date:tradeDate,fee:expected.total,feeEvidence:expected});}}console.log('Exact legacy differential: '+checks+' legitimate fee calculations matched');
```

## 交接与限制

需在精确候选执行原 dated-fees-common-risk、pending-buy-budget-consistency、effective-risk-evidence 等账户/回测测试与完整 CI，继而总管组合、授权行情和实际现场验证；本轮没有本地执行这些完整工程测试。历史缺证据可能新增保守拒绝，不能捏造费用。#437精确SHA的push CI、冒烟及浏览器查阅时已排队。未上线、实盘、修改账户配置或增加发布者。超大历史规模性能、实机及真实费率仍待。回退仅反向代码测试，保全原历史，不以恢复旧账本覆盖新增成交；旧版本仍存在负费用风险。总管保留各组 HANDOFF/DEPLOYMENT 追加记录。
