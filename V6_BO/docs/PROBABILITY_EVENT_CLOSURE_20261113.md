# 概率事件与旧历史统计入口修复

开发基线：`a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47`。本批只改概率契约、同事件研究排序、旧 `/api/backtest` 事件统计和实际展示文案。信号不可变证据、行情与模拟账本由其他批次负责。两张锁定主页不改字节。

## 数值契约

`src/core/probability-contract.js` 定义 `ztToday`（当日封板）、`ztNext`（次日封板）、`up3Next`（次日最高涨≥3%）。`pool/trend/pre` 为 `score`，目标为 null；未经登记的类型保持目标未知。显式目标与登记事件冲突时不借其他事件的经验或形态。

`fusedProb` 保留旧 `prob/model` 字段，同时增加 `valueKind`、`modelKind`、`target`、`calibrationCertified:false`。`valueKind` 为 `score`、`model-estimate` 或 `ranking-score`，描述兼容 `prob` 字段；`modelKind` 描述原模型。候选的 `prob` 原模型与 `fused` 排序值分别带 `probKind/fusedKind`，避免用排序类型标记原值。同事件历史频率与模型形成排序值仍不是校准概率。`auczt` 不调用只支持次日事件的 LEARNALL，最终输出仍封顶 45；原模型权重和策略阈值常量保持原值。

经验统计对命中、封板和质量使用独立分母与有效日期计数。缺失不是失败，观察到的 0 不变成缺失。`empInfo` 透传 `realRate/strongRate/okRate/fakeRate`；质量独立标为 `qualityToday/qualityNext`，只作诊断，不冒充封板率或次日+3%率。旧通用 `buckets.corr` 缺少同事件校准证据，`calibratedProb` 不再消费该混合桶。

## 实际入口

| 入口 | 实际消费/输出 |
| --- | --- |
| govFilter/govTake/logSignal 调用 fusedProb | 类型映射决定事件；排序与门禁消费同一研究值；原阈值保留。旧“次日+3%实测35%”底线仅可用于 `up3Next`，不能套到封板事件。 |
| 竞价推断与竞价推送 | 当日封板原模型估值；同日结果缺失时不借次日结果填失败；未独立校准，最终45封顶。 |
| 一进二/连板扫描、API候选与推送 | `ztNext`，只借次日封板频率与 `zt` 形态；候选携带 `_fz/probKind/eventTarget`，展示研究排序值。 |
| 盘中推送 fuseLine | 区分模型估值、研究分、同事件历史频率；不再称“学后胜率/已校准”。 |
| learnFusedReport 与日报 | 对照按事件分别统计，默认只统计 `up3Next`；不把当日封板或次日封板混进次日+3%率，也不把同批样本分档差异当成独立校准或进化有效性证明。 |
| 手机摘要的 probToday/probNd | 保留既有数值字段并附元数据：前者当日模型估值，后者次日+3%历史事件频率。锁定 mobile.html 不改。 |
| 埋伏 pre | 原规则与形态混合分保持，类型归 score；形态封板历史频率单列，删除全A可靠概率暗示。 |
| 旧 `/api/backtest` → backtestAsync/backtestSteps → app.js | `historical-event-frequency`；目标是下一根已知日K的收盘涨停或收盘涨幅≥5%，并非当日封板概率、成交胜率或费后收益。 |

旧统计不再编造 `mainPct=5`、市场总数5500或换手排名。历史资金必须有不晚于该日收盘的 `fundsKnownAt`，否则未知；排名未知保留，评分 basis 披露缺失。缺下一根收盘涨幅的样本跳过并计数。交易日数按实际观测日期去重。兼容保留旧中文结果键，新增明确 kind/target/限制/频率字段。

## 验证与限制

基线复现脚本固定读取 `a3a6c9f` 的源码副本，日志位于 `/workspace/remaining-output/probability-before.log`；修改后数值反例为 `probability-after.json`。全部 fake 的次日质量原来误抬当日模型60到74，现在保留60且单列真实质量0；竞价原模型45原来混次日形态到57，现在保持45；一进二fixture只采用次日封板20%而不借同批+3%命中100%，既有权重/惩罚计算研究分45。

实际运行：

- `node --test --test-reporter=tap tests/probability-target-integrity.test.js tests/backtest-event-frequency.test.js`：23通过、0失败。覆盖实际扫描→候选元数据→推送、govTake门禁、日报、运行结果与初始说明/接力卡片渲染，以及交叉事件、真实0、缺失结果、无效日期、缺时点资金等反例。日志 `probability-targeted.tap`。
- 受影响既有测试（`stock-risk-missing-neutral/model-public-features/model-selection-conditions/picks-three-k`）：20通过、0失败、1按原条件跳过。日志 `probability-affected.tap`。主页字节锁定通过。
- 旧专项：`_test_empcalib.js` 65/65，`_test_probkind.js` 42/42，`_test_auczt_prob.js` 16/16，`_test_auczt_calib.js` 25/25，`_test_gov.js` 26/26。旧断言同步改为 pre 是研究分、按原模型及目标查经验档、从实际 app.js 读取接线。旧“覆盖同日样本”静态要求由 A5 的真实 `logSignal` 行为回归接管。
- server、analysis、app、契约模块语法检查及 `git diff --check` 通过。主线程统一全量回归，本批没有重复运行全量。

使用合成样本与实际源码函数隔离执行，未调用真实供应商或发送通知，未验证生产盘中表现或收益。没有独立点时留出数据的 Brier/ECE/可靠性曲线；本批不认证任何概率可靠性。目标隔离会改变原本跨事件混合产生的排序与放行结果，属于已复现错误的纠正，不能宣称提高收益。JS仅修改必要文案与单位，未做原图或手机真机视觉验收，不声称1:1还原。

回滚：仅 revert 本批独立提交；不重写旧 stats，不删除原始模型或历史记录。
