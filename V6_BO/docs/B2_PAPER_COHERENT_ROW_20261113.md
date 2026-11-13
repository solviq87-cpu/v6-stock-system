# B2 模拟执行同一原始行情行｜2026-11-13

基线 `7ef3d560bdcc3a1b02fe17eae6f07ccc4a37ae26`。本批接续 [逐字段输入来源](B2_PAPER_FIELD_PROVENANCE_20261113.md)，修订其中仍允许“新缓存价格 + 旧股票执行字段”的政策；不改策略、费用、T+1、研究手工成交或旧账本格式。

## 执行行选择

`ingestPx` 在原有价格标记旁保存 `wireQuote`。它只复制20个执行/来源/权限相关标量字段，字符串每项最多240字符，不保存供应商嵌套对象或可变原对象引用。选中字段超界或非标量时保留价格标记，`wireQuote:null`，不能据此执行。未提供的接收时点不以本机接收时钟补写。

`paperAuthorityQuotes` 优先使用完整且原始报价时点15秒内的 `S.lastPx.wireQuote`，否则使用完整且新鲜的 `S.stocks` 原行。完整要求有效代码、价格、原来源/报价时点、正成交量和昨收；已提供的接收时点必须满足 `quoteAt <= receivedAt <= now`，未知接收时点仍可保持 null。来源/模式/权限排除政策继续作用于所选整行。

价格、成交量、昨收、名称限幅规则、停牌/可交易输入均取选中的同一行。缓存只有价格或字段不全时，不能借旧股票行补成交量、昨收或状态；完整新鲜股票行回退时，其价格也来自股票行。完整缓存原行可覆盖已离开全A列表的持仓代码。旧缓存价格仍可用于持仓估值/风险标记，价格标记本身不授予成交权限。

公开源调查：`em.js` 的 `normalizeStock`（东财）、`fetchBatchSnapshotTx`（腾讯）和 `fetchAllStocksSina`（新浪）均映射价格、量、昨收，但整个文件没有 `suspended` / `tradable` 映射。因此本批保留既有 `suspended === true` / `tradable !== false` 默认政策，避免把同一行修复变成全面停止自动模拟成交。缺状态仍在证据中记录 `present:false`、`rawBoolean:null`、`defaulted:true`；绝不从另一股票行取明确布尔值，也不声称停牌状态已经认证。

## 资金副作用与证据

`paperBuy` / `paperSell` 在改现金、持仓和流水之前取得完整执行报价，且将该批报价固定传入 `savePaper`，避免保存时重选另一价格行。通知读取提交后的权威投影。`paperCheck` 仍可按价格标记/估值进行研究判断，进入卖出函数时必须重新取得完整行并以该行价格执行；只有价格标记则跳过。旧式预先修改了资金/持仓的卖出状态在缺完整行时仍被 `saveLegacy` 拒绝，由 `savePaper` 回滚，无通知外发。`saveLegacy` 保持缺报价抛错、最终现金和持仓数量核对及原子发布，未改为跳过成交后继续复制旧资金状态。`savePaper` 提交失败仍强制重读权威账户。

新缓存原行的价格和非价格来源均为 `S.lastPx.wireQuote`；股票回退为 `S.stocks`。新缓存来源元数据还校验各字段的原行来源、模式和原行时钟一致。字段专属 `quoteAt/receivedAt` 仍为 null，原行时钟仅存于 `rowQuoteAt/rowReceivedAt`。同一原行不代表供应商或交易所同时认证，`independentlyVerified:false`、`canTrade:false` 和 `verifiedLive:false` 保留。

旧 `S.lastPx` 价格加 `S.stocks` 非价格的 v1 证据仍可读取，旧 hash/requestHash 不重算、不回填；研究手工 simulated/imported 用途保持原协议。本批没有改变旧 schema 或历史账本。

## 实际验证与限制

- 新增9项真实链路测试在精确基线为3通过、6失败；修复后9/9通过。覆盖 `ingestPx -> paperAuthorityQuotes -> paperBuy -> savePaper -> saveLegacy`，旧股票量1与100000000均不改变完整缓存行的1%参与率容量100000股；预算允许的实际成交数量同为900股，现金同为995元，费用5元。
- 联合14个文件的定向专项共102/102通过，覆盖缺量/昨收拒绝、完整股票整行回退、无效接收时序回退、缓存行独立/有界、字段专属时点未知、参与率拒绝后的内存/文件/通知无副作用、手工成交、旧证据/请求幂等、费用/T+1、权益、持仓估值和锁定主页。
- `npm run check`、核心来源模块语法检查、`git diff --check` 通过。两张主页 blob 仍为 `9e2fad468cb3e192df0ca2b9184babb2add8c4de` 和 `084e36d950f9bf4c3508aa1a5cb8986799b6079e`。
- 原始证据 `/workspace/next-output/paper-baseline-coherent.log`、`paper-targeted-final.log`、`paper-checks.log`。中间失败日志为开发过程，不与最终通过数相加。
- 未运行全量、生产服务、供应商网络、真实账户或通知；根任务负责固定集成后的全量和隔离服务验收。没有合并或部署。

本地Node v24.22.1另做6000行合成构造对照，执行原函数 `ingestPx + paperAuthorityQuotes`，各预热2次、计时7次取中位，每轮前GC不计入耗时。完整缓存命中后跳过股票列表的重复检查，不将全市场来源JSON序列化校验放进报价构造循环。

| 版本 | ingest中位ms | authority中位ms | 合计中位ms | 缓存条目/原行数 | 缓存值序列化字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 精确基线 | 7.32 | 47.91 | 55.24 | 6000 / 0 | 1536001 |
| 本批修复 | 18.28 | 49.92 | 67.43 | 6000 / 6000 | 3018001 |

每列中位分别计算；原行留存增加构造时间和缓存规模。这是本机合成输入结果，序列化字节不是实际堆内存，也不是生产性能认证。最终原始样本与复现脚本为 `/workspace/next-output/paper-benchmark-final.json`、`paper-benchmark.js`；早期 `paper-benchmark.json` 是移除重复检查前的开发测量，不作为最终指标。

可在 `V6_BO` 重跑：

```sh
node --test tests/paper-coherent-row.test.js tests/paper-field-provenance.test.js tests/paper-fill-evidence.test.js tests/paper-application-service.test.js tests/legacy-authority-integration.test.js tests/paper-unified-view.test.js tests/paper-account-ledger.test.js tests/paper-authority-quote-time.test.js tests/paper-original-quote-time.test.js tests/paper-execution-observed-price.test.js tests/paper-authority-write-rollback.test.js tests/market-consumer-contract.test.js tests/corporate-settlements.test.js tests/picks-three-k.test.js
npm run check
node --check src/core/paper-input-provenance.js
git diff --check
```

回滚以本批独立提交为单位，暂停模拟写入并先备份完整权威账户。不得删除新证据或用旧 paper.json 覆盖现有账户；回退读者对新增来源字面值的兼容性须在副本核对，不能让旧写者继续跨新证据边界追加成交。原有20MiB快照上限未提高。
