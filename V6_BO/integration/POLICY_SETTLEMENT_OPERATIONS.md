> 20261106av 最新检查点：以911项20261106au完整包为唯一新基线，新增学习参数冻结协议、训练/验证选型、一次冻结样本外/费用压力/成熟样本门禁、带修订的研究晋级与回滚，以及研究CLI --registry显式应用。操作见LEARNING_PROFILE_OPERATIONS.md；实际验证见TEST_REPORT.md。旧监视存储协议仍as，未自动改变其配置；主账户/原规则与布局保留。未接云电脑、未部署，外部六类验收仍待。

> 20261106as 当前检查点：基于861项20261106ar，本轮补本地自适应研究监视、不可覆盖版本、并发锁及中断恢复；主工程882项通过，最终干净结果见TEST_REPORT.md。当前接手入口为CHAT_HANDOFF.md和HANDOFF_NEXT.md，24项现场映射见ACCEPTANCE_LEDGER_20261106as.md。此前口头30%～40%没有统一工作量依据，撤回；本轮不宣称精确完成10%。未提供云电脑、未部署，真实数据/效果/短信/真机/云端/跨机验收仍待完成。

> 20261106ar 最新检查点：从823项20261106aq继续，按最新用户授权新增四指数（上证/深证/创业板/A50）经验方向预测、可配置行业/指数重仓回避、公开量化资料参考的三规则与成熟标签滚动学习，接入研究页面、worker HTTP、CLI及独立T+1模拟账本。原四套原始规则仍可对照，其显式逐日信号可参与研究权重适配，不静默替换生产规则。操作/来源/输入结构见ADAPTIVE_MARKET_OPERATIONS.md，最终回归见TEST_REPORT.md。三组本地功能不等于六类外部验收已关闭；未接云电脑，未部署。

> 20261106aq 最新检查点：从789项20261106ap继续，连续完成页面证据预检/整组导入/检查、收盘回撤与单日亏损参数、带SHA256及修订保护的文件运维CLI，以及原账户全部异步操作的账户/凭据隔离。主工程823项通过；最终干净结果见TEST_REPORT.md及operator-clean-tests.tap/.exit。原双端款式、四套策略与资金权限保留。操作见RISK_EVIDENCE_OPERATIONS.md最新段。真实供应商/收益/短信/真机/长期云端/跨机验收仍待完成，未接云电脑、未部署。

> 20261106ap 最新检查点：基于777项20261106ao继续，按用户两张参考图调整主站和/m双端UI，并补证据批量导入及只读预检。见REFERENCE_UI_OPERATIONS.md和RISK_EVIDENCE_OPERATIONS.md最新段；回归以TEST_REPORT.md最新记录为准。原四套策略规则、权限、资金边界保留，真实行情/样本外/短信/真机/云端/跨机验收仍待完成，云电脑未提供，未部署。

> 20261106ao 最新检查点：从758项20261106an主线继续。新增只读risk-evidence-status（HTTP/CLI），严格ISO时间及同刻冲突证据拒绝；补真实A/B权威写入和跨日成交验证，重置归档保留旧证据。见RISK_EVIDENCE_OPERATIONS.md最新段及TEST_REPORT.md。四套策略和UI布局保留，真实供应商、样本外及生产现场验收未关闭，云电脑未提供/未部署。

> 20261106an 最新检查点：基于上传746项20261106am完整工程继续开发，已补显式行业/账户前收盘证据导入、不可变版本、时点和上一交易日校验，并接入A/B自动模拟权威提交。操作见RISK_EVIDENCE_OPERATIONS.md，实际回归见TEST_REPORT.md。以下旧批次文字保留追溯，冲突以本条及最新报告为准。真实供应商和生产现场验收仍未关闭。

# 风控、权益、历史股票池与拒单审计

## 主账户接口

开发者POST /api/research/order-account；CLI node scripts/paper-account.js <账户文件> <请求JSON>。电脑和手机均可打开/research.html的“模拟盘风控与权益”卡片。只读账号不能读取高级账户、审计或提交操作；副本允许read/audit，禁止写。旧独立研究账户接口继续隔离，不混用资金。

configure沿用configuration.expectedRevision；riskPolicy增加maxSectorPct、maxStrategyPct、maxConsecutiveLosses，均为可选；归因、行情或历史证据不足时拒绝。原四套策略买卖规则未改，只有显式配置才启用新限制。新增strategyId必须为明确归因ID；历史未归因持仓不能凭空补名。riskContext的sectors是代码到行业映射，classificationAsOf不得晚于委托日期，observedAt仍有180秒时效限制。sector/前收盘指标需要来自已导入证据，未配数据的旧自动路线可能被新风控阻断，不假造指标放行。

连续亏损按权威账本中按序的已实现卖出退出记录计数（含部分卖出），遇到非亏损退出重置；退市清算的已实现亏损同样计入。不等于自动计算完整往返交易的统计口径。

feeSchedules可选commissionScope为fill（原默认）或order-day。同一委托、同一交易日、同一费率版本累计计算最低佣金；跨日/版本分开，不追改历史。新成交复检其他委托冻结资金，防跨日最低佣金重置侵占冻结。所有旧接口默认费用模型保留；显式新配置时启用共用费率/风控适配。

## 权益结算

action=settle，参数settlement和expectedRevision。settlement必须含eventId、actionId、symbol、kind、source=imported、provider、sourceRecordId、effectiveDate、publishedAt、expectedQuantity、expectedCostBasis、cashDelta、shareDelta、basisDelta。类型支持cash-dividend、share-distribution、rights-subscription、delisting-cash、fractional-cash。必须使用供应商明确的净现金和整股结算证据；不从价格跳空推断权益。

现金与股份可分别在不同生效日提供事件；小于一股的尾数须供应商提供净现金结算。配股扣款与成本相符；退市核销全部股份及成本；有同股票未完成委托时拒绝，其他委托冻结资金也不能用于认购。主账户仅当前日期顺序入账，事件ID精确幂等。当前仓位/成本与凭据不符时拒绝，不按策略结果缩放权益数量。

整数零股提供liquidateOddLot=true的sell委托，必须覆盖全部剩余持仓；仍受可卖日期、冻结股数、价格与成交量限制，不允许借此买入零股。只有显式权益可流通证据允许对应分配股份当日可卖；普通新买保持T+1。

研究回测可传settlements数组；数据是账户特定的结算凭据。独立四策略账户使用history.strategySettlements或portfolioConfig.settlementsBySystem分别提供fourteen/bazi/gpt/python数组；有主研究结算表时，必须明确各策略的数组（无权益可为空），不能把主账户权益复制给各策略。

## 历史股票池

universeHistory每行：symbol、from、through、knownAt（带时区）、eligible、source、可选sector。区间不能重叠；不存在记录或knownAt晚于决策时点则不可新买。选择在前收盘、成交在当日开盘分别校验。退出股票池不删除存量持仓；实际停牌/退市要按行情或结算证据处理。缺省保留旧行为，不能因此宣称幸存者偏差已真实验收。

## 拒单审计

action=audit，pagination支持afterSequence（从0开始）与limit（1～500）。每个权威账户旁的.audit.json为独立哈希链审计，不是第二套资金账。拒单只记业务白名单、原因码、输入指纹、配置版本、当时估值/归因证据；不写完整请求体、令牌或任意异常堆栈。证据超1000项时明确truncated=true，不宣称可完整复算。

审计损坏会阻断后续写入；8MiB满额需停写、备份后按运维流程归档，目前没有自动归档/轮换接口。审计文件、.guard锁路径和权威快照需要一致的Linux目录权限；备份恢复须一并处理审计文件，不能删除坏审计来绕过校验。SHA链不是外部签名认证。

## 外部边界

公开接口、operator imported标签与本机测试均不等于供应商认证。真实来源、行业时点、账户权益证明、交易制度、长期运行、HTTPS/短信/真机/跨机灾备仍待现场验证。权益业务通过显式结算导入实现，未部署自动供应商权益抓取/认证任务。
