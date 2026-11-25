# FAYO L1/L2 代码补齐与验证记录

记录时间：2026-11-25 11:39 UTC。基线：`7427debbcda37cbf6183af6e2627fc5fad02e301`。本次只完成代码及隔离验证，不发布、不接触生产数据。

## 真实调用链

主实例的既有服务器计时器调用 `decision-center-background.js`。盘中只轮转已有财报研究任务，交易日 16:00 后轮转历史研究；每分钟最多派发一个采集任务。历史采集沿用 `researchPrimary()`、`isReplica()`、中心启用配置及供应商请求调度器。页面查询不发起历史网络采集。

`intelligence-history-collect` worker 读取原短线主档案，再调用 `collectCenterHistory()`，明确传入代码与截至日。独立目录来自 `V6_CENTER_HISTORY_DIR`，未配置时由服务器使用 `data/intelligence-center-history`。原 `root` 仍是短线档案目录，不能用新目录覆盖它。

两源分别为：

| 来源 | 原始请求 | 价格与数量处理 | 原始证据 |
|---|---|---|---|
| 东方财富历史日线 | `klt=101`、`fqt=2`，明确证券市场与代码 | 后复权；成交量从手乘 100 转股；成交额为人民币元 | 原响应字节、SHA-256、请求 URL、实际接收时间 |
| BaoStock 日线 | `frequency=d`、`adjustflag=1`；逐行再次核对复权字段 | 后复权；成交量为股、成交额为人民币元 | SDK 原字段快照、SHA-256、起止时间与实际接收时间；明确不是网络原始字节 |

身份、排序、日期、复权、OHLC、量额、停牌与日历校验通过后，`auditCenterInputs()` 再按同代码、交易日及复权口径做跨源容差准入。超阈值记录与原回执保存在独立隔离证据中，不能进入研究价格集。没有把前复权或不复权资料改标签。看盘前复权与原成交不复权边界保持不变。

日线的 `periodEndAt` 只表示该日 K 线的区间结束，不能当作源端发布时间。`knownAt/observedAt` 均保存实际取得时刻，`sourceTimestamp=null` 明确供应商未提供历史首次发布时间。旧校验的冻结时点保持不变；当日历史实收后可另建一个当时真实冻结的中心观察，保留 `originCheckId/originalSignalAt`。它只能预测下一交易日起的标签。

采集用跨进程 `flock` 覆盖完整请求过程；同票同日完整采集幂等、失败至少间隔 15 分钟、最多三次。写入沿用私有研究档案哈希链，不修改原行情库、账户、权限、账本或生产权重。后续来源修订不会覆盖首次保留值。

## 落选股票的翌日标签

`intelligence-history-pending` 是只读 worker action，不能取今天候选池作为历史信号全集。它扫描持久中心观察及原真实校验，优先给已冻结但缺下一交易日合规后复权标签的代码派采集；今日落选也保留任务。旧信号缺事前已知的 t 日价格或交易日历时，不能通过事后补采修复其因果性。

接口：

```js
runWorkspaceJob({
  action: 'intelligence-history-pending',
  root: shortlineRoot, historyRoot, day, now, cursor: 0, replica
});
// { ok: true, codes, pending, coverage, researchOnly: true, canTrade: false, ... }
```

每次最多扫描 40 个代码、返回 30 个任务。`coverage.nextCursor` 供下一轮继续扫描，避免只固定首批股票；后台五分钟缓存按原代码保留尚未解决任务。`pending` 给出 `code/signalDay/nextTradingDay/signalAt/reason`。`coverage` 给出数量、截断、等待下一收盘与不可补原因。超过保守 160 日补采范围的标签明确排除，不改用别的日期。

`intelligence-history-collect` 返回 `{ok:true,result}`；外层成功只表示 worker 执行完成。调度器必须以 `result.status` 为准，只有 `admitted/already-collected` 才完成该票当日采集；`partially-admitted/quarantined/missing-dependency` 不能伪装成功。

## 报告、因子与模板

`intelligence-research` worker 读取原短线档案与独立历史库，输出 `historyIntake`、真实时点对齐结果、训练拟合正交化、IC、Walk-Forward 与分层统计。研究读视图最多 20 个代码、每代码最近 400 个交易日；`omittedCodes/omittedEarlierObservations` 及 `factors.sampleUniverse` 明确范围。这是有界研究样本子集，不是全市场或全部 95 项有效性的认证。

Q 保留五个固定权重；未知保持 `null`。历史接收快不算当前行情实时性。隔离的来源冲突通过 `historyIntake.intakeQuality` 纳入一致性分母，不会因没有入研究价格集而消失；同一代码与日期取最新一次采集比较，不累计重试抬高权重。

六类模板均有独立证据评估。首板、一进二、弱转强反包、龙头与情绪择时须验证原自动校验记录、完整条件名称及数量；首板/一进二还核对原封板池身份，情绪择时还核对原情绪依据。三进四沿用既有严格实现。`observed-unvalidated` 只说明观察成立；缺项、条件未过和原记录缺失分开显示。所有模板仍为 `not-oos-validated`，不能自动增加共振或触发交易。

## 执行收益、成本压力与原批准流程

`intelligence-execution-validation.js` 仅使用已关联事前冻结计划的原模拟结算：核对毫秒成交时间、T+1、数量、逐批成本、原结算哈希、费用及净盈亏。黑天鹅与不可复制极端样本分层；演示和教学样本排除。不能把后复权收盘标签收益当成交收益。

成本场景叠加双边 0/5/10/20 基点滑点及 1/2 倍费用；原费用已扣，不能重复扣同一份。按市场环境、情绪周期以及 Walk-Forward 阶段分别报告。训练/验证截止时点之后才知晓的结算不能进入此前阶段。

最少五个真实核验结算才有成本压力布尔结论；不足为 `null`。累计已结算盈亏回撤单列人民币值，没有连续账户权益时，`portfolioDrawdownPct=null`、`portfolioRiskStatus=missing-continuous-equity-evidence`。这些报告不能批准模型。

实际结算投影继续通过原 `store.mjs` 的 `learn:auto-candidate` 回流，使用原五项验证，再由带当前 revision 和编辑权限的 `learn:decision` 批准。中心 IC 权重提案本身不直写该流程，`feedback.validationBridge.proposalImportSupported=false` 明确这一点；没有新增绕过原批准的权重导入协议。

## 依赖与验证边界

运行依赖复用既有 `curl`、`flock`、Node 与 Python 3。Python 可通过 `V6_PYTHON` 指向现有隔离环境；BaoStock 的既有固定依赖为 `requirements-research-sources.txt` 中 `baostock==0.9.4`。未安装时明确返回 `missing-dependency`，不自动安装。现有源码包规则包含 `scripts/`，会包含新的 Python 文件。

本次没有实际调用外部历史供应商、安装依赖或采集生产资料。供应商持续可用性、真实样本数、全部因子 IC、模板 OOS 有效性及连续权益回撤均不能凭代码或测试宣称已验证。

验证命令：

```sh
node --test tests/center-history.test.js tests/center-hfq-python-collector.test.js tests/intelligence-execution-validation.test.js tests/intelligence-template-library.test.js tests/intelligence-research.test.js
```

结果：55 项 Node 测试通过、0 失败、0 跳过；其中 Python 包装项实际执行 7 个无网假 SDK 测试。涵盖真实 worker 读取路径、落选翌日任务、时点反泄漏、跨源隔离、单位、进程锁、幂等、有限重试、首次值保护、损坏/符号链接拒绝、成本、分层、重复结算与条件证据缺项。五个相关 JS 模块语法检查及 `git diff --check` 通过。

供应商字段依据：

- [AKShare 原东方财富适配实现](https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_hist_em.py)
- [BaoStock 原 Python API 文档](https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md)
