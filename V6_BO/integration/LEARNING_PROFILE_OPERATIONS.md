# 学习参数研究晋级与回滚（20261106av）

本轮基于911项20261106au完整工程。新增CLI研究参数注册，不修改真实账户，不连接券商，不自动改变四套原始规则文件或后台监视器配置。双端布局保留，仅同步缓存版本。

## 一次冻结实验

输入为当前自适应研究完整JSON，必须有simulation与完整交易日历。最多20只、400根/只、合计5000行；候选1至4个。成本协议固定，当前不支持带日期feeSchedules的压力评估，不能忽略费表强行算过。持有1个交易日；原生nativeEvidence模式保留、禁止混手工信号或未来/未知键，原生splitDay需在训练段内部。

协议JSON示意（日期须替换为实际输入内的日期）：

```json
{"schemaVersion":1,"version":"experiment-1","trainEnd":"2026-08-19","validationEnd":"2026-09-23","holdoutEnd":"2026-10-28","gates":{"minClosedTrades":3,"maxDrawdownPct":10,"minReturnPct":0,"minExcessReturnPct":0,"costStressBps":10},"candidates":[{"id":"prior4","parameters":{"learningConfig":{"minimumSamples":20,"priorStrength":4},"selectionPolicy":{"minUpProbability":0.55,"maxIndexWeightPct":2.5}}}]}
```

训练段至少61根，验证、样本外各至少20根，holdoutEnd须为整个冻结输入末日。费用/滑点/税费不得低于原默认8/10/5bps，学习成本代理不得低于41bps；成本压力会同时再增加每边手续费和每边滑点，不降低原账本风险限制。

候选白名单：minimumSamples为20至200的整数；priorStrength为2至100；minUpProbability为0.5至0.9；maxIndexWeightPct为大于0且不超过3。不能通过参数候选取消四指数、方向预测、行业或权重证据门禁，也不能改变费用或券商设置。未填写项按原默认值解析；baseline保留冻结输入原有的学习/回避参数。

## 命令顺序

```bash
node scripts/learning-profile.js freeze /safe/new-experiment /safe/input.json /safe/plan.json
node scripts/learning-profile.js evaluate /safe/new-experiment --expected-revision 1
node scripts/learning-profile.js holdout /safe/new-experiment --expected-revision 2
node scripts/learning-profile.js promote /safe/new-experiment --expected-revision 3
node scripts/learning-profile.js status /safe/new-experiment
node scripts/learning-profile.js verify /safe/new-experiment
node scripts/learning-profile.js rollback /safe/new-experiment --expected-revision 4
```

数字是最简单顺序的示例，每步先看返回revision；不自动读新修订后重试，不存在--force绕过。freeze只向新目录写入规范化输入、冻结协议和state，已有目录拒绝覆盖。冻结中断可能留下不完整目录：核验会拒绝，不自动补齐或删除，保留后用新目录重跑。

evaluate只跑训练和验证前缀，先按固定门槛筛选，再按验证收益（同分按ID）选一个候选，不读取样本外成绩。每个账本段从同一初始资金独立开始、使用此前历史作指标/学习预热，不把训练资金仓位带进验证。日内截止固定为上海16:00；学习继续只用成熟的过去标签。这里冻结的是参数和评价流程，样本外采用固定参数的向前滚动学习，不是冻结全部已学权重。

门槛包括已平仓最小笔数、至少一条规则达到其成熟学习样本门槛、最大回撤、最低净收益、相对baseline的最低超额，以及验证/样本外的成本压力结果。所有门槛必须预先显式填写。minExcessReturnPct=0允许持平，不证明优于baseline；若要求改进应在冻结时设正值，不能看结果后改门槛。

holdout只能使用已选候选，不提供手工改选参数；第一次结果保存后重复调用不增加修订或换模型。失败实验不能晋级。工具无法证明操作者此前未查看原始历史，所以这不是第三方盲样本认证；冻结目录不应反复换区间来挑好看的结果。

promote在内核锁下重执行验证及样本外证据，比对结果指纹，只有全部通过才切换本实验的研究active指针。rollback原子恢复到本实验baseline；保存原配置、输入、协议、成绩及from/to/revision操作记录。不是跨实验全局生产配置管理，更不是券商交易放行。未来如改变算法，原包与冻结目录应一起保留；复算不符时停止，不能改指纹强行升级。

## 显式使用激活参数

```bash
node scripts/adaptive-research.js /safe/future-input.json /safe/new-report.json --registry /safe/new-experiment
```

只允许同source/provider、冻结样本外之后的新日期；保留原输入版本和研究参数指纹/注册修订。必须维持冻结的学习成本、执行费用及财务风险约定、回避行业名单和原生证据模式。新日期的权益/动态成分表可更新，不能顺便改成本/风险或把模拟训练配置用于真实导入来源。激活后的独立资金账本只统计冻结区间之后的新观察期：默认start自动设为后续首日，显式start不能退回训练/验证/样本外段，且至少有两个后续观察日。较早的学习版本仅是本版参数的预热复算，不证明历史当时已启用；新报告包含所用parameterProfile，回滚后再次运行即用baseline。旧的两参数adaptive-research CLI不变，未传--registry不会自动应用参数。

当前页面/worker、监视器不会自行读取本实验目录；需显式研究CLI消费，后续如接HTTP或后台自动消费，应固定服务端路径、验证来源/当前修订和权限，不能接受请求体中的任意服务器文件路径。主权威账户完全不受本注册器影响。

## 本地验证及保留边界

覆盖冻结/样本外顺序、改样本外不影响验证选型、弱样本/收益门槛阻断、伪造成绩重算拒绝、失败样本外指针保护、并发锁、发布失败保留旧快照、实际SIGKILL发布后恢复及真实CLI晋级/回滚应用。SIGKILL不等于物理断电；SHA不是外部签名，无法抵抗有权限者伪造整套数据和协议。

输入数据与费用是声明，未认证供应商或真实收益。研究晋级仍是canTrade=false；真实样本外有效性、供应商自动输入、完整监视历史归档恢复、短信、真机、云端长期运行和跨机灾备仍待。没有购买资源，未部署云端。

兼容性：旧监视报告仍按as协议只读核验；本版学习报告新增priorStrength等参数元数据，既有au离线导出若要求逐字节复算应使用随包保存的原au代码，不能改清单或覆盖历史报告来绕过差异。
