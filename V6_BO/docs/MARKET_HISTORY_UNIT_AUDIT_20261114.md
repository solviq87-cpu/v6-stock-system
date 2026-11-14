# V6 行情数据准确性增量修复：日K单位与双源金额一致性（2026-11-14）

## 基线与定位

- 只以本次核验的 `dev@6b1e3df22b67a09c4932a21919a65c149da49d19` 为起点，独立分支：`fix/market-history-units-and-evidence-20261114`。
- 原代码 `src/core/eastmoney-historical-feed.js` 直接把东财 f56 放进 `volume`，没有指定是“手”还是“股”，并且没有请求/保留 f57 成交额。这使金额与股数的绝对口径无法可靠用于流动性和多源核对。
- 原 `src/core/market-feed-consensus.js` 比对 OHLC 与 `volume`，但忽略了 `amount`：两个数据源价格和数量完全一致、成交额差 1000 倍时，仍可能报告 `consensus=true`。
- 这是 **研究数据形态与数值门禁**，不能据此认定公网来源真实、供应商独立、行情有实盘授权或可交易。

## 从成熟开源项目借鉴的设计，而非导入其源代码

- Qlib：https://github.com/microsoft/qlib — 原始数据与标准化数据分层、明确证券/交易日历。
- vn.py：https://github.com/vnpy/vnpy — 不同 datafeed 的能力隔离，Tick 与 Bar 不互相冒充。
- FinRL：https://github.com/AI4Finance-Foundation/FinRL — 统一数据清洗及缺失值语义，避免不知不觉用“0”填缺失。
- AKShare：https://github.com/akfamily/akshare — A股多类公开接口，不能把外层 SDK 名称当作独立上游身份。
- f56/f57 字段与单位实务参考（非交易所背书）：https://github.com/wonchermaine960/eastmoney-cli/blob/main/docs/API.md；东财日K f56=成交量（手）、f57=成交额（人民币元）。上线前需以真实供应商官方字段定义及样本成交额再校验。

## 本次实际代码改动

1. `src/core/eastmoney-historical-feed.js`：向供应商显式请求 f57；把 f56 手 ×100，统一为 `shares`；保留 f57 的原始 CNY 成交额；拒绝缺金额、空值、非数、溢出、零量非零额及非零量零额。不用复权价格伪造成交额，也不造一根缺失的K线。
2. `src/core/eastmoney-historical-feed.js`：引入 `volumeUnit='shares'`、`amountUnit='CNY'` 和 `amountBasis='actual-unadjusted-turnover'`。日K价格仍为 `qfq`，**实际未复权成交额不能与前复权价格直接计算成交均价**。
3. 数据集标识由 `em-qfq-` 升为 `em-qfq-v2-`；避免旧单位数据与新单位数据在同一个身份下静默混用。导出 CLI 本就采用只创建新文件且拒绝覆盖旧历史；迁移时请使用新的文件名/受控重建，不能直接覆写旧账本。
4. `src/core/market-feed-consensus.js`：如果任一来源标注成交量单位，要求两边均为 shares；如果任一条有成交额，要求两边都声明 CNY 与原始成交口径，并比较每根 K 线的金额。单边缺金额记覆盖差异，超过默认 5% 差异记 `amount`，均不得假报一致。旧无金额的离线 fixture 兼容，但无权声称股数单位已经验证。
5. 端点请求日期使用北京时间市场日期，避免服务器运行在中国市场午夜附近误用 UTC 昨天。
6. 增补 `tests/eastmoney-historical-feed.test.js` 和 `tests/market-feed-consensus.test.js`：金额单位、1000倍错单位、字段缺失、非数、溢出、零成交、跨午夜、双源金额冲突和失败不覆盖原文件。

## 门禁/验收

```bash
cd V6_BO
node --test tests/eastmoney-historical-feed.test.js tests/market-feed-consensus.test.js tests/market-data-center-e2e.test.js tests/feed-discrepancy-quarantine.test.js
npm run check
V6_MODEL_PYTHON=python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

仓库 `.github/workflows/v6-ci.yml` 已对功能分支 push 与 PR 安排真正的完整测试。**当前记录仅为提交和测试设计，不等于这些命令在本会话已执行、GitHub CI 已通过。** 以最终 PR head 的 CI 结果为准；有失败不合并。

## 没有虚构的“准确率”与下一步

- 仍需从各供应商取得真实市场样本，在相同股票、交易日、价位和成交额上对账，检查数据使用许可及调用频率；公共接口或第三方字段文档不等于交易所证书。
- 将 AKShare / efinance / BaoStock 等适配器统一转为 shares/CNY、价格复权口径，保留原始字段与转换版本，禁止对未知单位猜测。
- 后续增加官方交易日历、停复牌及公司行为的逐日 PIT 核验、双源上游独立性声明校验、源时点新鲜度与断流回放、实时/延迟/研究三种数据权限隔离。
- **不动** 电脑/手机锁定主页、旧报价15秒门禁、账户和部署发布者；当前修复属于 `V6_BO` 后台离线数据逻辑，不改变模拟/实盘权限。
- 回滚：在未合并时关闭 PR 即可；合并后用正常 Git revert 回退本 PR 所有提交，绝不复制历史 ZIP 覆盖最新工程。
