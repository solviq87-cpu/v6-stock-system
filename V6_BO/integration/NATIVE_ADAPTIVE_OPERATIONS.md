# 四体系自动适配与可复现离线导出（20261106au）

本轮两项：①原生逐日证据自动适配到研究学习层；②原始输入、原生独立回放、融合报告的离线导出及确定性复算工具。不是完整监视历史的归档/灾备工具；HANDOFF_NEXT中的1000条/128MiB历史恢复任务仍未完成。

## 输入与时点

沿用ADAPTIVE_MARKET_OPERATIONS.md的研究JSON，新增可选字段：

```json
"nativeEvidence": {
  "schemaVersion": 1,
  "snapshots": {},
  "pythonEvidence": {},
  "splitDay": 32
}
```

splitDay可省略；提供时要求2至历史长度减3之间的整数，原生独立回放用它划分样本内/外，跨界交易不混入两侧。未指定时不宣称已经样本外检验。该分割不构成训练/验证/冻结样本外的完整候选晋级流程。

原生自动模式每天固定上海时间16:00作为证据截止；目标日decisionAt必须不早于16:00。日线需在当日截止前已知；晚补日线拒绝运行，避免将事后更正静默用于历史选择。快照/Python证据晚于当日16:00时不用于当日判断，记录omitted；未来追加历史仍使用相同每日截止。原有非自动研究输入的时点规则不变。

自动模式不得同时携带任何bar.originalRuleSignals或bar.originalRuleEvidence；先移除手工信号，避免冲突或不明优先级。未提供nativeEvidence时保留原显式信号模式。没有快照时仍调用原生14条/八字评估器，缺失信息按原评估器返回unknown；GPT因子不完整保持unknown。Python必须带独立三轮原生执行证据，不在导入时执行任意Python代码。

snapshots和pythonEvidence均以`600000/2026-06-30`这样的股票/交易日期为键；未知股票、非交易日、未来日期拒绝。

快照须有symbol、observedThrough（等于键日期）、knownAt（严格带时区ISO时间，且不早于当日15:00）、provider和version。允许的上下文字段仅name、floatCap、sector、auction、profitRatio、gptSnapshot、gptSnapshotObservedThrough、market；不允许覆盖rows、price等原生输入。GPT快照字段见原策略包strategies/a-share-strategy-pack.json，观察日期必须相符。输入来源是声明，不表示供应商认证。

Python格式见python-three-round-evidence.js，另须knownAt：symbol/date/observedThrough、python-native/前缀evaluatorVersion、python-runtime:前缀provenance、恰好三轮round/verdict/observedThrough/reason。三轮均pass才触发，含unknown则未知，其他失败；来源/轮次不合法整组拒绝。

## 使用

普通CLI、worker以及现有监视器均自动识别nativeEvidence：

```bash
node scripts/adaptive-research.js /safe/native-input.json /safe/new-report.json
node scripts/adaptive-monitor.js /safe/native-input.json /safe/native-runs --once
node scripts/adaptive-monitor.js /safe/native-input.json /safe/native-runs --verify
```

监视器仍要求同一版本不能代表不同历史事实。切换自动模式应使用新输入version和独立输出目录，保留已有手工信号研究对照；不覆盖旧报告。报告新增nativeAdaptation，含每日16:00截止、四体系覆盖率、未知/失败区别、原生信号及来源、逐日判断、晚到证据清单和独立回放。只有pass映射成学习信号；保留成熟收益标签与入场证据门禁。读取旧报告及页面权限不变，原生评估文件未修改。

离线导出：

```bash
node scripts/native-adaptive-bundle.js /safe/native-input.json /safe/new-bundle
node scripts/native-adaptive-bundle.js --verify /safe/new-bundle
```

目录必须不存在，且输入必须开启nativeEvidence。输出input.json、native-replay.json（完整适配审计，含独立回放）、adaptive-report.json、manifest.json。原始输入文件不写入；归档input.json是同一JSON的规范化副本，不声称与原始空白字节相同。输入上限8MiB，输出每文件上限32MiB。文件指纹核对后重新执行当前代码并逐字节比较，报告和清单一起篡改也能发现与输入不一致；输入与所有结果一同被一致改写无法证明真伪，指纹/复算不替代可信签名或数据认证。

导出在独立暂存目录写入、fsync文件后，以mkdir排他保留目标目录，再逐个硬链接、最后发布manifest并fsync目录。禁止覆盖已有目录；进程异常中止可能留临时目录或不完整目标，核验应拒绝，保留现场并选择新目录重跑，不自动删除/修补已有归档。不宣称整个目录原子发布、断点恢复或跨机灾备已完成。

核验要求目录中恰好上述四个普通文件，拒绝符号链接、缺失、多出、超限、指纹不符及复算差异。需要本地支持硬链接、目录fsync的文件系统。后续规则代码版本变化可能导致复算不一致，因此跨环境复现需保留同批完整工程。

## 结果边界

原生独立回放是原四套对照；融合研究仍执行四指数、行业/权重、交易状态、成熟标签及可选资金模拟规则。两者选股、持仓、成本口径不同，不能直接比较收益数字。两类结果canTrade/verifiedLive均为false，不接真实券商、不修改账户、不自动晋级生产。所有新增验证使用fixture，不证明真实预测或收益有效。

本轮未增加页面控件，仅统一应用缓存至20261106au；保存协议仍20261106as。真实数据、候选参数晋级/回滚、完整历史归档/恢复及六类现场验收继续交接。
