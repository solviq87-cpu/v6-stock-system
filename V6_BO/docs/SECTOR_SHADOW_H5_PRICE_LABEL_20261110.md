# V6 板块影子候选：五交易日价格收益标签的严格研究桥

2026-11-10。本模块独立于正式策略和模拟盘，沿用已有 `forward-signal-observer.js` 的价格、时点、日历、公司行为处理。**不做额外网络请求，不合并未经授权的第三方行情，也不修改正式因子权重。**

## 为什么不直接把板块轮动分数当作收益

PR #92 只生成同日强度的影子候选；PR #95 的 3/5 交易日观察只描述分数和上涨广度变化，不能当成真实持有收益。新增 `src/core/sector-shadow-h5-price-label.js`，只接收一个已冻结行业的**完整成分股名单**以及已有冻结信号和价格观察协议，重算严格的未来第5个交易日毛价格收益。

## 输入和必要约束

调用 `evaluateSectorShadowH5PriceLabels(preflight, membership, cohort, market, {sectorCode, now})`：

1. `preflight` 是 PR #92 的 `inspectSectorShadowEligibility` 当时返回的成功预检，不是事后按收益重算出来的强势名单；身份和时点均需保存。
2. `membership` 是同一天、同分类版本、行情观察之前的冻结成员对象；选中的板块必须是 `industry` 分类并有 **5–500 只**互异股票。现有 `freezeCohort` 一批最多500个信号，所以超出500只的完整行业**一律拒绝**，不许挑500个赢家冒充全部成员；未来要扩大覆盖，需先另设可验证的批次合并协议。
3. `cohort` 必须由已有 `freezeCohort` 在信号当日生成，`feed.source=imported`，全体成员一只股票一个独立ID；`system=manual`、`cohort=sector-shadow/industry/<行业代码>`。信号时间不得早于同日北京时间16:00，冻结不得晚于本日，且离信号时间不超过5分钟，离同日板块观察时间不超过2小时。这个界限防止研究用次日数据补造前一日信号。
4. `market` 是操作方已合法取得的未复权日K证据，需使用与冻结cohort完全相同的 `provider` / `datasetId` / `priceBasis`，包含明确交易日历、每位成员的基准日与将来日期的收盘价、成交量、停牌、公司行为标记。必须保持此前冻结的同日 `baselineClose` 精确一致。源或任何记录冲突会被已有 `evaluateForward` 拒绝。
5. 仅取原观察器 **H5**（第5个未来交易日）窗口，不把自然日、第二个价档或3/5日板块分数之差冒充收益。未来数据不足为 `pending`；停牌、缺价、公司行为为单独未知状态，不填0。
6. **整个冻结行业5日观察全部有效（100%覆盖）**，才输出等权成员未复权毛收益 `grossMeanReturnPct`、`grossMedianReturnPct` 和 `labelsAvailable=true`。即使80%成员完成，报告也只能显示每只已观察的毛价格变化，整体行业标签仍为空，防止选择偏差。行业内股票等权不等于实际行业指数，不含交易成本或可成交条件。

## 输出永远不是训练许可

无论数据结果，始终有：

- `priceSourceAuthorized:false`：本模块不能独立确认来源许可；具体授权需外部人工核实。
- `prospectiveCertified:false`：用户输入的时间戳和 SHA256 并非独立的第三方时间戳证明。
- `outOfSampleValidated:false`、`canTrain:false`、`autoPromotion:false`、`weightsChanged:false`、`productionWeightsChanged:false`、`canTrade:false`、`canNotify:false`。

这一步**能够在真实完整数据事后出现时生成价格收益标签的研究结构**，但没有自动采集数据，也没有训练或生成已验证的新策略。需要单独建立多交易日、不可事后改动的真实前瞻档案，按时间训练/验证/保留集隔离，加入行业/市值控制及成本后再研究收益稳定性，不能直接将本输出送入现有因子晋级入口。

## 测试

在 `V6_BO` 执行：

```sh
node --check src/core/sector-shadow-h5-price-label.js
node --test tests/sector-shadow-h5-price-label.test.js tests/sector-shadow-learning-preflight.test.js
npm run check
npm test
```

合成协议测试覆盖同日冻结、完整成员、负收益、未来日期未到、短交易日历、价格缺失、停牌、公司行为、虚假/异源价格、错版分类、回填信号、成员子集及大于500股的行业。合成测试通过不等于真实A股已验证、供应商许可已确认或国内服务已部署。严格不修改 `public/index.html`、`public/mobile.html`、正式15因子/四套策略、模拟盘及账本。