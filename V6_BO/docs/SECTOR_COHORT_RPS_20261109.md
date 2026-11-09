# V6 板块横向历史相对强度分位 · 2026-11-09

## 目的与定义
用户希望大盘—板块—个股三级联动时，不仅看单一板块相对指数，也能与**本次确实提供可比历史数据的其他板块**横向比较。
本批实现仅为**同一历史样本中的可比板块相对收益分位**，非全市场RPS、不代表外资/北向/主力资金、不证明某股上涨的原因。

## 数据要求
- 已声明 `source: 'imported'` 的历史研究股票数据；每个参与者需提供 `market.factorContexts[证券代码]`。
- 每组包含21个严格对应个股交易日的市场指数与板块历史收盘价；指数限上证、深证、创业板之一。
- 相同 `provider` 声明、相同指数基准、相同21交易日历，且所有股票声明的同一市场指数收盘价一致；数据来源仍**未经独立核验**。
- 排除显式标识的模拟/合成来源、日期不一致/缺价数据及同一板块的冲突序列。不采集外部股票报价。
- 至少**三个不同且完整可比的板块**才报告横向分位；一个板块代表多只股票，只作为一个板块排名单元。不在数据不足时补0或猜测板块。
- 如果已用的来源、指数或市场序列之间发生冲突，整个比较标为 `unknown`，不生成伪排名。

## 公式
`sectorReturn20 = 100 × (sectorClose[t] / sectorClose[t-20] - 1)`。

对 N 个可比板块，设 `less` 为收益严格低于目标的板块数，`ties` 为相等板块数：
`samplePercentile = 100 × (less + (ties - 1)/2) / (N - 1)`。
这样高位为100，低位为0，并列分位采用中间位置。本口径是**样本内 percentile**，不是公开行业数据库的全市场RPS。

## 使用边界
- `src/strategy/sector-cohort-rps.js`：一次性对历史研究集合计算；`bySymbol` 只包含合格证券，`sectors` 以不同板块计。
- `src/core/research-explanation-projection.js`：额外返回 `sectorCohortStudy` 和个股 `rationale.sectorCohortRps`，未通过的个股写 `unknown`。
- `public/assets/complete-workbench.js`：仅有合格数据时显示“板块横向研究分位”，标明分母与非全市场范围。
- 原四套策略、模拟盘账本、研究观察池排序和正式权重完全不变；不接实盘、不开放买入或自动升权。
- 当前模型并未独立核验数据源合法许可、停复牌、市场全量覆盖率及上线站点运行条件，因此不能称为可用于生产交易的证券行业排名。

## 自动验收
`node --test tests/sector-cohort-rps.test.js tests/research-explanation-ui.test.js`；
GitHub PR 需全部CI通过后合并 dev。
真实成交、行情接入、样本外与部署站点仍分别验收。
