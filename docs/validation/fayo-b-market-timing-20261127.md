# 绯曜 FAYO · B组第二批：观察时点真实性

## 基线与范围

- 本组首批独立PR #430，固定dev `0c45291d7156be8a1206f0bb272f3c719d5d2336`，第二批起点 `2392e4b54df74a8ec840e78614c1b084dbe0964e`，五个源码/测试变更的候选提交 `ee667313fd0142b72571a72c59fb2248670ddda0`。
- 总管 #427 本轮读回 `6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f`，159个路径，已包含首批 observed-market-regime 的同一 blob；live-market-research 仍为原 blob。#429 C组及 #431 D组的已读路径无本批直接交叉；仍须总管确认最新HEAD、共享合同与增量合并。
- 对应 21.1–21.8、21.12–21.16、B-EX05/14/25/28/47/48 的时点证据部分，不将这些编号标记全部完成。原78/66项、原四策及正式账户风险边界保留。
- 不修改 shared server、HTTP路由、策略参数、正式权重、账户、下单、通知网关、部署。仅在既有只读环境分类和联网研究链增量。

## 复现及修复

旧分类入口只比较日期：固定11月5日10:00的离线夹具，明确晚于截点的评分可知时间、快照接收时间、上一日供应商报价、不同市场/评分数据截点，四种原错误均实际复现为 usable=true、regime=trend、存在研究权重。

- 新 `observed-market-timing.js`：明确时区的ISO时间或合法毫秒；无时区、秒值、假日历日期、未来、倒序、跨数据日、非法供应商原时点、采样跨度矛盾均阻断。显式快照与评分 asOf 必须一致；分页采样沿原120秒上限，独立评分截点须处于已声明窗口。历史研究允许后来取得旧日快照，但不得在当时不可知的决策截点使用。
- `observed-market-regime.js`：采用一次冻结的研究时钟；时点矛盾输出 usable=false、regime=null、weights=null；缺时间仍兼容旧描述研究，`timingEvidence.status=unknown`，不认证同一时点。完整显式对齐只标 declared-aligned，不认证供应商真实、交易日历或交易资格。providerTimeCoverage 是具备可解析原时点的有效记录占冻结市场分母的比例，不是实时时效覆盖。
- `live-market-research.js`：真实默认采集使用独立系统时钟；注入回放默认冻结 now，显式注入测试时钟才可推进。拒绝无效或倒退时钟；候选报价审计、板块研究与环境分类同用独立完成截点，不从数据负载 retrievedAt 推进决策时间。迟到评分及未来报价不可令候选 evidenceReady。风险状态仍 research-only/unknown/blocked，始终不准交易。
- 本批严格时间解析是内部研究契约增量，1990—2100年毫秒范围（f124维持原2000—2100年规范）；同一完整asOf严格相等，不自作主张设置近似容差。外部HTTP尚未确认新增元数据可完整贯通，不能承诺实际生产双端已展示；A组与总管确认前不改变接口或启用策略政策。仅日期输入无法防止未声明的未来信息，必须在后续严格shadow政策中主动弃权，不能把旧usable当可信/交易资格。

## 实际验证

Node v22.16.0，局部文件从精确Git blob核对；原20项保留，新增17项分类时点与5项联网时钟联动，共42通过、0失败、0跳过。
命令 `node --test --require /tmp/fayo-b2-local-loader.cjs V6_BO/tests/*.test.js`。该目录只有五份目标测试，非全库。局部loader对缺失的真实网络采集模块、板块适配器使用会抛错的未调用替身；所有联动测试通过注入离线快照，实际分类、报价审计、候选交集、原风险研究门禁源码均为真实远端一致版本。未运行真实网络、真实板块联动、HTTP、完整旧测试集、context:resume、正式CI、浏览器或实机。新增测试已按正常仓库require写入，不依赖此本地loader；远端完整CI必须再次确认真实依赖行为。原五处目标JS语法检查通过，局部git diff --cached --check通过。三处源码与两份测试的上传后Git blob逐项核对一致。

局部旧行为复现日志SHA256: 8d8a54e2761ab4ef7f2b46e535ab71714dcb2d28f103be2354b10fab39000835
修复后42项TAP日志SHA256: 9239c800bf84aaadd98ff1198cb71b58f208037eebb5544174accf2489a2b01f
局部未调用依赖loader SHA256: 86b413a2fa72f0d379e582c0ddbaf7ed967f8e95a806e2cc3cda56ea9733f8ad

| 目标 | 已核对Git blob |
|---|---|
| observed-market-timing.js | 2fd5720df25b03acc0f2b0f7be2c9cbff98a16e0 |
| observed-market-regime.js | 0f530e637295052196dd14ddcdc60d6e8ac05d0b |
| live-market-research.js | 2d4b475c5b5dbf04f28772923d04ae8c818d60b2 |
| fayo-b-market-timing.test.js | 070f9aeab470625426e8d06e50f9def0db84d42d |
| fayo-b-market-live-clock.test.js | 97d144f6b1000d20253e5e129b1e598b21a7a1cb |

## 剩余与交接

保持#430草稿，由总管按独立精确增量接续首批组合，不重复覆盖已合并的首批源码。A组负责真实字段、分层历史成分/交易日历与完整HTTP时点传递；D组采集时钟回拨门禁 #431 独立验证；C组个股风险否决与账户风控不由本组实现。下一批先做有效参与率、中位数、完整金额覆盖和指数/等权背离证据；不得用宽基指数上涨冒充全市场上涨，不据成交推断机构净流入。多轴环境、可验证的机会政策、独立校准、样本外验证及端到端推送仍未完成。未修改数据档案，无迁移，回滚第二批仅需恢复原两处研究模块并移除新增helper/测试，保留首批。禁止自行合并dev、发布、下单或发送通知。
