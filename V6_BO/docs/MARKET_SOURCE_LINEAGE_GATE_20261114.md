# V6 多源真实上游辨识与历史证据安全门禁（2026-11-14）

## 范围与基线

- 基线 dev@2d4d90054b3576a2a8c06e8af5277ee794eed62b，新功能分支从该 SHA 分叉；不改 PC/手机锁定主页、交易账户、自动发布者。
- 原 `market-feed-consensus.js` 只拒绝两个相同 provider 标签；实际上 `efinance`、`Choice` 和部分 `AKShare` 接口属于东方财富上游，不应当被数作两家独立供应商。
- 根源分类仅为本地已登记的**包装接口→上游家族**规则，不是实际物理链路独立认证。开放项目 Ashare、AKShare 通用客户端可能走多个上游，必须记录每次实际响应对应的来源；默认保留“未知”。

## 本轮增量变更

1. `src/core/market-source-lineage.js`：增加带别名的上游家族表；东方财富/eFinance/Choice/AKShare-EM 属于同一家族，腾讯/BaoStock/新浪分别列明；同家族直接拒绝，来源声明与已登记供应商冲突也拒绝。未知包装不可用自我声明升格为独立认证。
2. `src/core/market-feed-consensus.js`：保留原有价格、成交量、金额、日期、复权、时间核验；附加来源家族、7项**证据覆盖分**和保守决策。该指数不是股价准确率，也不是供应商真实性概率；即使满分也只有研究证据，不允许交易。
3. `src/core/market-data-center.js`：开启严格模式。配置第二来源时，必须是两家已登记且不同的原生上游、OHLCV 与成交额单位均符合 shares/CNY、每根金额覆盖完整、两路本地采集时间差≤5分钟且数值在容差内，否则拒绝写入，不覆盖历史文件。
4. `src/core/baostock-eod-research-bridge.js`：保留 BaoStock 原始未复权、实际停牌、公司行为，并按 BaoStock 字段文档声明 shares、CNY、unadjusted。采集时间不是交易所报价时间，仍研究专用。
5. `.github/workflows/v6-ci.yml`：新增独立 history-source-lineage-safety 状态检查，覆盖专项用例；既有完整回归继续保留。

## 真实限制

- 已登记“不同上游家族”不能证明不存在代理、授权、重放或基础设施共用；原始交换所报价时间与供应商许可均未认证。
- 当前严格链路只验证数值/单位/采集时点，供应商真实停牌状态与公司行为仍须分别持有可验证的逐日证据，不能用价格、零成交倒推停牌。
- 当前东方财富独立的历史 `eastmoney-historical-feed` 为 qfq（前复权），BaoStock 为 unadjusted（不复权）；**不得直接把两者强行对账**。需要东方财富原生 fqt=0 或其他标准化不复权输入，且相同股票、日期、采集覆盖区间才可比较。
- 未联网采集真实行情样本，未宣布数据“百分比正确”；真实行情服务许可、访问频率仍需操作员确认。未重设生产策略或账本。

## 可复现检查

```bash
cd V6_BO
node --test tests/market-feed-consensus.test.js tests/baostock-eod-research-bridge.test.js tests/market-data-center-e2e.test.js tests/eastmoney-historical-feed.test.js
npm run check
V6_MODEL_PYTHON=python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

GitHub Actions `history-source-lineage-safety` 与原 `verify` 完整测试必须以实际同一 PR SHA 的运行结果为准；代码提交不代表 CI 通过或生产已部署。回滚使用此 PR 对应提交的普通 Git revert，不得覆盖较新的工程文件。

## 东方财富不复权可比输入（同分支补充）

- `fetchEastmoneyHistory({ ..., adjustmentMode:'unadjusted' })` 明确使用 `fqt=0`；旧默认 `qfq/fqt=1` 完全保留，两种模式使用不同 datasetId，禁止混写历史。
- CLI `node scripts/eastmoney-historical-import.js 000001 2026-09-01 2026-11-13 /abs/private/em-unadjusted.json --unadjusted` 创建新文件，不覆写旧数据；请求与日期仍遵守原有安全限制。
- `observedAt` 是本地采集完成时间而非供应商原始市场报价时间；供应商是否真正返回不复权行情须通过真实样本和公司行为资料核验。
- 真实 BaoStock 和东财样本可能缺交易日或出现复权差异；不会强制补齐，也不会在冲突时认定某一方真实。
