# B1：旧研究扫描器历史账本约束修复（2026-11-13）

## 范围和基线

本次从 `a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47` 开始，针对真实的
`POST /api/research/ledger` → `src/strategy/position-ledger-backtest.js` 链路修复。
继续调用原 `universe-scanner.js` 和原四套策略，没有替换成 v2 选股器。
不修改正式策略参数、行情采集、模拟账户、自动学习、主页或部署配置。

基线存在以下可复现问题：买卖滑点越过当日涨跌停价；多股票日期错位仍按相同数组索引成交；
历史扫描拷贝当前股票级资金等分数；普通 `walkForward` 导出丢掉卖出受阻的整个样本。
本次初版 13 项反例在基线为 1 项通过、12 项失败；原始记录为
`/workspace/remaining-output/backtest-before.tap`。

## 最终行为

- 原扫描器只接收截至信号日的 K 线、当日可见的 `bar.factors`、当日价格与状态。
  股票级当前 `capitalScore`、竞价分和公告等字段不会被带回历史。
  已声明 `factorsPublishedAt` 晚于当日收盘的因子不可见；有日期时扫描时钟是该日北京时间 15:00。
  未声明发布时间的旧 bar 因子仍可兼容研究，但明确未验证。
- 各股票必须逐日同日期、单调递增。停牌需要保留共同交易日占位；提供 `tradingDates` 时逐项核对。
  完全无日期的旧输入仍可研究，输出标记 `undated-legacy`，不能据此认证真实日历。
- 复用现有开盘涨跌停门禁，不用当日后续高低价推断开盘成交；未触板时，买入滑点价不高于涨停价，
  卖出滑点价不低于跌停价。保留 T+1、整手、佣金、卖出印花税和次日开盘执行。
- 卖出停牌、封板或容量不足时保留并继续估值，后续交易日重试。部分卖出按比例转出成本，剩余股份继续持有。
  可选成交参与率与最小成交额门槛复用 `core/execution-risk.js`，只读取前一个完成交易日的量额；
  启用参与率但缺少明确 `shares` 单位时不能假定成交。
- 公司行为复用已有明确权益模型和结算表，只执行事前发布且日期可核对的权益事件。
  不能从价格缺口自行推断现金分红或送股。同日同证券禁止混用旧 bar 权益和结算表。
- HTTP 账本入口传递并校验交易日历、容量、日期费率、风控、历史成分和权益结算参数。
  自定义函数、路径或外部采集不通过此接口执行。
- 普通 `walkForward` 导出使用原扫描器和逐日账本；`dailyEquity` 提供每日净值，`equity` 保留原周期采样形状。
  CLI `backtest` 继续走原扫描器账本，默认整手/印花税口径不变。
  显式 `legacyWalkForward` / CLI `backtest-legacy` 只供旧结果对比，输出明确说明会剔除受阻退出，
  不能用于逐日账本净收益或回撤验收。普通 `walkForward` 兼容原默认 `lotSize=1`、`sellTaxBps=0`，
  正式研究建议显式冻结这些参数。

## 未验证证据必须保留

结果始终是 `researchOnly=true`、`canTrade=false`、`verifiedExternal=false`。
`dataProvenance.historicalEvidence` 分别披露日期、日历、历史成分、逐日证券资格、未复权声明、公司行为和因子可见性。
用户提供日历、历史成分或 `corporateActionsVerified` 也只是声明，不能变成外部真实性认证。
缺少逐日 ST/停牌/可交易字段时披露 `unverified-stock-fallback`；缺少历史股票池时披露 `legacy-unverified`。
固定板块或输入的涨跌幅规则不代表已覆盖每只股票的历史上市制度变化。

账本减少了剔除受阻亏损的偏差，但没有证明历史全市场、已退市证券、动态成分、资格和公司行为完整，
没有解决真实订单簿排队和冲击成本，也没有完成真实 A 股收益或实盘认证。

## 验证和后续真实数据验收

新增 `legacy-ledger-trust-closure.test.js` 覆盖四板块双向滑点边界、错日/缺日拒绝、
未来股票级/后续 bar 突变不影响历史、收盘后发布因子不可见、逐日状态、历史成分、未知证据、
容量受阻和部分退出、公司行为中性权益、精确佣金与印花税对账、旧入口保留受阻亏损。
`legacy-ledger-http.test.js` 启动临时目录中的真实 server，使用合成编辑权限和本地 HTTP 请求，
验证真实路由接受并执行上述限制，拒绝非法参数和未授权访问；测试不使用真实账户或真实采集。

最终 18 个定向测试文件共 74 项通过、0 项失败/取消/跳过，记录在
`/workspace/remaining-output/backtest-final-targeted.tap`。全量检查由主整合分支执行，不能由本记录代替。

后续真实数据验收复用现有 `core/historical-validation.js` 的 `validateDataset`、
`core/research-validation-suite.js` 的数据 SHA 和既有研究工具，不另建重复的行情采集/冻结系统。
冻结原始文件 SHA、来源/版本/截至时点、完整共同日历、逐日资格/成分、未复权价和明确公司行为、
费用与容量参数、代码 SHA 及预注册样本区间后，在独立运行中核对现金、持仓、权益和每笔费用。
`runValidatedBacktest` 使用 v2 策略，不能用它的数值替代本次原 scanner 链路的验收；
原 scanner 应调用 `position-ledger-backtest` 或 CLI `backtest`。
本批合成回归只证明约束和账本一致性，没有把真实数据验收标为完成。

回滚使用本提交的 `git revert`，不要以旧压缩包覆盖当前开发分支。

## 集成复核补充

公开战法远期审计 `public-rule-forward-audit.js` 同样约束双向滑点到该执行日的涨跌停边界，
不把未触板的开盘价加滑点后变成制度外成交价。新增实际命中规则的买卖边界反例在修复前失败，
修复后该文件 10 项通过；记录 `forward-limit-before.tap`、`forward-limit-targeted.tap`。

原 scanner 账本和实际 HTTP `/api/research/ledger` 增加显式 `strictHistoricalStatus:true`。
开启后，使用区间内任一天缺少日期或逐日 `isST/suspended/tradable` 布尔状态都拒绝运行，
不能用股票级当前状态填补。此模式是后续真实历史数据验收的必要条件之一，
不是证券资格、公司行为或供应商真实性认证。旧输入默认继续兼容研究，仍披露
`unverified-stock-fallback`，其状态变化可能影响历史结果，不能当作已消除这类时间泄漏。
