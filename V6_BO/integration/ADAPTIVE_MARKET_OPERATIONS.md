# 四指数预测、回避偏好与滚动学习（20261106ar）

本轮三组为本地研究/模拟功能，不表示真实行情、策略收益、短信、真机、云端长期运行或跨机灾备已完成。应用从823项20261106aq继续；原四套原始规则保留可对照，新研究层允许其逐日信号参与自动权重学习。没有购买云资源、连接CMR/多模型网关或真实券商。

## 已接入与公开资料依据

- Qlib在线/滚动模型管理：https://qlib.readthedocs.io/en/latest/component/online.html 。借鉴按时间更新、保留版本的机制，本地实现成熟标签的滚动权重学习；不是安装、运行或完整移植Qlib。
- Backtrader均线交叉：https://www.backtrader.com/docu/strategy-reference/ 。本地规则为MA5上穿MA20，参数是本项目配置，并非官方默认策略参数。
- Backtrader Donchian：https://www.backtrader.com/recipes/indicators/donchian/donchian/ 。本地规则为收盘突破前20根日线高点，不把当根高点放入门槛。
- Backtrader布林指标：https://www.backtrader.com/docu/indautoref/ 。本地组合为前日收盘在下轨外、当日回到20日两倍标准差下轨内；不是官方收益策略背书。

以上只参考公开的通用数学和工作流，自行实现，不复制项目代码、不引入其运行依赖。工程原本已有ridge/extraTrees/histBoost、动量/低波动、十类战法，本轮未把旧功能再算成新增。来源不证明策略更优，必须逐样本验证。

## 入口及输出

开发者POST /api/research/adaptive-market；/research.html新增“市场预测与自适应选股研究”，导入最多1800KiB JSON后运行；界面显示市场环境、候选数、模型版本、模拟收益及四指数各自的次期上涨经验概率。输入/令牌改变使旧响应失效。服务端2MiB限制、最多1个研究任务、30秒超时、256MiB worker内存预算；不在主事件线程训练。

离线命令：`node scripts/adaptive-research.js <输入JSON> <新报告JSON>`。输入最多8MiB普通文件，报告拒绝覆盖已有文件及同路径输入；同目录暂存后以硬链接发布，防止并发覆盖历史版本。每次运行按新数据重新演算并保存版本，不运行后台数据抓取，也不直接改真实账户。报告可以重放同一数据，原输入应自行完整保留。

## 输入结构

顶层：schemaVersion=1，source为imported/simulated，provider、version（非空字符串，最多160字符）、asOf（YYYY-MM-DD）、decisionAt（含时区完整ISO时间），indices、stocks、sectorEvidence、weightEvidence；可选selectionPolicy、learningCostBps、simulation和tradingCalendar。

indices有四个独立键：shanghai、shenzhen、chinext、a50。每个提供provider、version、bars；a50必须显式instrument=index或future，不以科创50/上证50替代。bars每行date、knownAt、open/high/low/close/volume；A50每行还须显式sessionCloseAt，区分期货/指数及会话时点。大陆默认15:00收盘，knownAt不能早于收盘。只使用目标日及决策时点以前的行，四指数日历不强行对齐，A50没有当日已知收盘就不能作为完整当日环境放行。

stocks最多50只、每只最多600根、合计最多20000行，symbol六位代码、market/limitPct明确交易制度。各股行内OHLCV日期对齐；每根需knownAt；候选及可成交标签还需isST、suspended、tradable明确布尔值和statusKnownAt（状态获知时点）。开盘执行时statusKnownAt必须不晚于当日09:30。不根据当今ST状态回填历史。未复权价格及权益结构沿用原历史账本校验；输入缺行情、状态或证据不猜测。

sectorEvidence为原显式导入schemaVersion=1、kind=sector格式数组，逐tradeDate提供完整代码映射及classificationAsOf/publishedAt/knownAt/version/provider。最大1000条；不能把当前行业倒灌历史。weightEvidence最多1000条，每行source=imported、provider/version/tradeDate/weightsAsOf/publishedAt/knownAt，weights按代码映射到shanghai/shenzhen/chinext/a50四个百分比。非成分股也需供应商显式给0，缺字段不当作0；同一获知时点内容冲突拒绝，键顺序不构成冲突。

## 默认回避与预测口径

默认avoidDefensive=true、avoidHeavyweights=true、maxIndexWeightPct=3（任一指数权重>=3%排除）、requireMarket=true、requireForecast=true、minUpProbability=0.5。默认行业名单含银行/保险/证券/白酒/非银金融及对应英文别名。可用excludedSectors数组替换名单（最多50项）；按明确行业标签匹配，不用股票名或模糊关键词推测。maxIndexWeightPct可调，回避不是泛指所有大市值股票。

四指数分别按“收盘是否在20日均线上、五日方向”分组，使用已经走完的下一观察日收盘收益，输出加一平滑的历史上涨经验概率和均值。每种状态不足20个成熟样本不预测，不能把未知显示成50%。报告有先前冻结预测的Brier误差和方向正确率，不是同一批训练拟合精度；并非经真实样本认证的概率或确定涨跌预言。默认还要求四指数当日环境齐备且非risk_off、平均上涨经验概率至少0.5，否则候选阻断。

指数数据自身的下一观察日，只有供应商/日历完整时才对应下一交易日；无正式A50全会话日历时不能据此宣称已验证下一交易日预测。缺样本可在明确研究实验中关闭requireForecast，但报告保留设置，不偷偷绕过。

## 自动学习及原四体系

新增三规则自动从历史生成；行内originalRuleSignals可明确给fourteen/bazi/gpt/python的逐日true/false。缺少原体系逐日证据时，不编造原体系信号。当前信号只在下一日开盘进入、再下一日开盘退出后才成为成熟标签，无法成交（状态未知/涨跌停/零成交量/入场证据阻断）或涉及显式权益事件时不作为普通收益标签。

学习用扣learningCostBps的开盘到开盘收益代理，默认41bps（对应默认双边费用/滑点及卖出税费的一阶近似），不等同最低佣金/复利/真实成交。各规则累计成熟样本，至少20个后按Beta加一平滑胜率作为研究权重；不足时为等权先验0.5，并明确trained=false。原四体系逐日信号可以用同样方法在研究融合中动态调整权重；不改原始规则文件、不静默上线新阈值。每日报告有版本指纹、样本量和最近成熟日期，保留最近60个版本；不是无限历史存储。

新数据导入并再次运行后，成熟标签会自动更新权重；尚未接入真实供应商的持续自动抓取和无人值守生产升级。追加未来数据不会改变已经产生的过去版本。数据源事后修订旧数据需新的输入版本和指纹，不能把修订数据伪装成当时已知。

## 独立模拟与边界

simulation提供原历史账本配置，须同时给完整tradingCalendar、只支持holdDays=1，与当前标签约定一致。原账本继续处理费用、滑点、T+1、涨跌停、流动性/资金限制和权益。新增可选entryEligibility钩子只在买入开盘时复检当日行业、权重及可交易状态；卖出减仓不被回避偏好卡住，原回测未提供钩子时行为不变。历史资金独立，不导入主权威账户，不执行真实下单。

当前结果始终canTrade=false、verifiedLive=false、brokerConnected=false。这是研究组合与独立资金回放；真实四体系样本外效果、供应商来源认证、幸存者偏差、完整公司行为和多日实测仍待验收。全量回归和fixture上涨率不能当作真实策略收益证明。

## 测试完整性补强

干净解压的初次运行出现TAP少报用例但原进程退出0。该结果不作为全量通过：原日志adaptive-incomplete-clean.tap经新完整性检查被拒绝，日志与退出码另存。全量脚本取消--test-force-exit，改为每个测试文件120秒上限；默认TAP报告额外核验每个顶层Subtest都有对应结果、序号连续且结束计划一致。五项新测试覆盖完整嵌套报告、悬空用例、缺计划/断序、失败结果及Node普通脚本包装的独立文件编号。最终结果以新运行和最终干净复测为准，不将845/849/851等中间计数当作当前完成数。
