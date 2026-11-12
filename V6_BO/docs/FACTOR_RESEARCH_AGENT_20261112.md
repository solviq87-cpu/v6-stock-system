# 因子研究智能体：可运行的自动研究闭环

基线 dev：ef1ebdc0ed7475abf46deb61cdb5e3f858b2f948。此版本增加独立研究能力，不改两张锁定主页、正式15因子包/四套策略、账户或订单门禁，不启动生产采集/部署/真实推送。

## 这次补充了什么

现有系统已具有动量、波动、趋势质量、前瞻冻结、样本外检验、预算与衰减冷却。本次复用这些能力，新增状态驱动的感知→计划→执行→复盘→持久记忆，避免再造一套看似学习却绕过原门禁的流程。

- 感知：只使用有来源的输入、原始捕获回执和封存研究血缘；制定计划时不打开未来收益文件。
- 计划：条件就绪且今天未封存时捕获，否则观察；缺少数据、先验候选、独立新样本或预算时等待，异常时暂停。
- 执行：调用现有每日研究链与严格影子学习进程。不会执行模型生成的任意命令，也不会自行改代码、买股票或更改正式策略。
- 复盘与记忆：私有、只追加的哈希链事件，记录输入/决策/完成后的血缘和实际阶段；同一证据不重复运行，重启不遗忘试验和冷却。记忆只用于运行调度，不是晋级授权。
- 展示：/research.html 新增状态、下一步、因子出处和计算入口；两个API均要求编辑者权限。未配置数据时如实显示未配置。

## 候选因子与公开依据

从 [Microsoft Qlib Alpha158定义](https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/loader.py)独立实现三项新增量价特征：CORD20（收益与量变化相关）、VSUMD20（成交量增减平衡）、WVMA20（量加权绝对收益离散度）。数学公式、版本、差异和MIT来源说明在 strategies/public-research-factors.json 与 PUBLIC_FACTOR_SOURCES_NOTICE.txt。

第四项是 [Amihud原始研究](https://archive.nyu.edu/handle/2451/26706)的20日人民币成交额改编，只认实际成交额，不用收盘价×成交量伪造。所有因子的方向/效果均为待验证研究假设，不因公开论文就认证A股收益。参考 [Alphalens](https://github.com/quantopian/alphalens)的评价思路，延续本系统既有IC、覆盖、相关性、样本外、交易成本和多次试验检查；未安装或复制不明许可证的Alpha101实现。

每次计算需要21个严格对齐的交易日、完整日K、原始 availableAt、明确价格/成交量复权、单位、版本与调整时点。缺失、停牌、零成交、常量相关输入和非法分母返回 null及原因，不填零、不前填。元信息仍是来源声明，不是交易所或独立认证。

## 新因子怎样进入模型

默认模型仍为 baseline-v1（原8项特征）。显式选择 featureSet=public-volume-v1 时加入三项新量价特征；public-volume-liquidity-v1 再加入真实成交额因子。

```sh
npm run research:models -- /private/model-input.json
npm run research:public-factors -- /private/feature-input.json
```

模型输入继续使用原 stocks[].bars 作为未复权成交/成本账本数据；另提供 stocks[].factorHistory={bars,metadata或metadataByDate} 存储复权研究序列。原信号日 availableAt 必须在同一交易日结束前，每个特征只看当时已发布的独立序列。全局 tradingDates 必须显式提供，不由股票缺行反推日历。未来序列或后来复权版本不能进入更早预测。原15因子/生产评分不改变。

Amihud原始结果保留1/CNY；模型向量使用固定1e8乘数，单位转换记录在protocol.featureInputTransforms，避免树模型因极小数量级实际忽略特征。不要把样本覆盖变化造成的回测差异说成新因子增益；比较必须使用共同的时点股票池和完整试验档案。

## 运行与配置

示例 config/factor-research-agent.example.json 仅提供结构，里面的路径不会自动创建数据、取得供应商权限或启动服务。

```sh
# 零写入预览；将示例中的路径换成真实私有输入/独立输出
npm run research:agent -- once /private/agent-config.json
# 执行一轮，所有写入仅为私有研究档案
npm run research:agent -- once /private/agent-config.json --apply
# 明确启用持续研究；30秒到1小时轮询，收到SIGINT/SIGTERM后停止
npm run research:agent -- watch /private/agent-config.json --apply --interval 60000
```

配置字段为 schemaVersion=1、mode=v6-factor-research-agent、researchOnly=true、canTrade=false、cycle、outputDir；cycle使用原每日研究配置。输出与输入/其他写入目录不得重叠、嵌套或符号链接；目录0700、事件文件0600。遗留锁或被篡改的链不得自动清除。部分步骤写入后失败会立即停止watch，并在记忆中保持暂停；换日期、换输入或重启不能绕过。核查部分归档与锁之后，只有手动 once --apply --ack-failure <最后失败事件的完整SHA> 才允许重试，确认记录也进入只追加链，watch不能自动确认。

若要在运行中的V6服务查看该研究进程状态，将V6_FACTOR_AGENT_DIR设为同一outputDir；API只返回经过校验的阶段/摘要，不返回私有路径、原始数据或模型权重。

新因子HTTP输入 schemaVersion=1、asOf、observedAt、tradingDates、stocks。每只股票需要symbol、bars和factorMetadata。factorMetadata需要source、datasetVersion、priceAdjustment=split-dividend-adjusted、volumeAdjustment=split-adjusted、adjustmentAsOf、volumeUnit=shares。Amihud另需amountUnit=CNY和amountBasis=actual-unadjusted-turnover。POST /api/research/public-factors 在独立worker内执行，限制2MiB/100只股票/10秒；不阻塞主交易服务执行模型训练。

## 修复的原自动学习门禁缺口

原每日流程调用shadow worker没有强制运维模式和事前注册。现在固定启用operatorMode、requirePreRegistration、autoRegisterCandidate，不回退兼容的事后调参模式。初始启动需要已有封存研究或明确登记的候选；没有先验不会假称自动产生了可靠模型。

事前注册封存所有原始回执对应特征，包括尚未成熟的H5前缀。等待这些旧前缀成熟，不把它们冒充登记后的新信号；至少5个登记之后成熟日才进入下一步，核心仍按持有期重叠进一步检查独立性。事前注册/预算检查始终在读取新候选H5结果之前执行。

研究代码指纹也包含实际worker、每日编排和回执血缘规则。升级后旧候选可能明确失效：不删除旧档案、不改其SHA绕过；审计后按新的时点重新登记并等待未来信号。正式模型、预算累计和历史回执不重置。

## 验证与边界

新增验证涵盖公式独立算术、未来/缺失/停牌/单位、模型因果性与原账本隔离、真实HTTP编辑权限、反复执行/重启/篡改、旧pending前缀、等待新样本、计时器溢出和网页转义。本地全量1982项通过，0失败、0跳过；真实HTTP/公式专项15项通过，完整服务启动冒烟和语法检查通过。CI结果以最终提交日志为准；本地证据目录 /workspace/evidence-evolution。

浏览器1440/375视口已实测状态读取、4项因子来源、手动上传计算、缺失金额保持未知、恶意来源字符串不执行。均使用明确合成数据，不代表实盘效果或真机验收。

本轮已在执行环境创建不入库的私有配置和研究目录，并启动60秒轮询的watch。真实输入尚未配置，实际状态为needs-data、模型版本为空；不是已完成真实训练。工作环境停止后，持续服务需要在目标服务器上用上述命令与真实配置重新启动。模型是否改进仍须新的独立样本证明，系统不承诺越学越赚钱。
