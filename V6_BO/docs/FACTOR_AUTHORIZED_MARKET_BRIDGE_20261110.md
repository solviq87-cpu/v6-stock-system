# V6 因子研究｜授权历史行情到冻结观察的受控适配（2026-11-10）

## 当前缺口

V6 已有导入合法历史行情的 market-data-center，也已有收盘后冻结选股/因子、5交易日成熟观察和1/5/20/60行业中性研究程序。但前者是含OHLCV的原始历史数据集，后者要求显式的未复权收盘市场协议。不能拿当前行情、股票综合分或脚本当前时钟造出过去的信号和价位。

本次新增的 factor-authorized-market-bridge 只读取操作者已经合法取得的历史JSON，转成既有 forward-signal-observer 可以消费的EOD市场快照，不连交易所、不爬取公开或收费网站、不下单、不打开实盘。

### 强制源字段

- 采用已有历史数据输入协议，必须有 schemaVersion=1、source=imported、provider、datasetId、asOf（YYYY-MM-DD）、priceBasis=unadjusted、stocks及逐日真实OHLCV；
- 新增强制的 **observedAt**：上游对该批次行情的真实观测毫秒时点，须为原asOf北京时间16:00以后、且不能晚于运行时钟。没有原时点一律拒绝，不能在转换时填 Date.now() 或伪造供应商收盘时点；
- 每只股票必须有一致的真实交易日bar及**明确的每日suspended布尔值**、明确的corporateActions日期数组（允许[]但必须由上游声明），不能通过成交量猜停牌、通过涨跌幅推公司行为。只接受未复权数据；bar若带corporateAction，必须已登记在该股公司行为日期中；
- 只从来源给出的**所有股票一致的日期K线**生成显式交易日历；不得按自然工作日生成所谓交易所日历。不完善或不同步的交易日列表拒绝；
- 至少32个已记录的交易日、至多500只股票；转换后的私有EOD观察快照限制4MiB，超限需由合法数据生产者分批；
- 导出的feed.source=imported、provider/datasetId来自原始数据集，保留原observedAt不改动；externalSnapshotFingerprint为对原JSON对象的SHA256摘要，**仅表示一致性，不等于上游来源真实性、数据许可或独立数字签名**。禁止将token、券商私有配置、选股账户等写入输入JSON。

这允许复用 V6 已有获授权的历史导入格式，但**不会补齐原数据确实缺失的 observedAt/停牌/公司行为信息**。没有此类证据的现有来源只能继续作为单独参考，不能强行晋级为因子训练输入。

## 私有目录操作

在V6_BO目录。首先进行无写入检查，判断同日行情与候选池、逐票因子原始证据是否能互相匹配：

    npm run factor:source:preflight -- /srv/v6-private/authorized-history.json /srv/v6-private/picks-current.json /srv/v6-private/factors-current.json

输出包含两层检查：authorized-history-contract 和 signal-time-factor-freeze-contract。通过时status为local-contract-ready-not-certified且contractReady=true；providerCertified、liveDeployed、trainingReady、canTrade均为false。被拒绝时返回blocked及具体环节的原因，退出码为2。它不会写文件、启动观察、补齐缺失因子，也不会打印任何原始私有payload。

把已获得的历史行情安全转换成只能新增的私人文件：

    npm run factor:market:once -- /srv/v6-private/authorized-history.json /srv/v6-private/market-2026-11-10.json

或者将已新增交易日、且历史已观察价格不回写的来源转换成当前共享研究文件：

    npm run factor:market:sync -- /srv/v6-private/authorized-history.json /srv/v6-private/market-current.json

在已有合法上游负责**原子更新来源文件**且已明确配置独立唯一进程的部署环境里，可开启：

    npm run factor:market:watch -- /srv/v6-private/authorized-history.json /srv/v6-private/market-current.json --interval 60000

- once创建私有0600不可覆盖文件，相同内容重复执行不新增；
- sync/watch采用本地单写入锁与原子文件替换：相同数据不重复发布；新交易日只能追加观察证据，不允许删减旧日期、改写过去某只股票的价格、停牌、公司行为或突然切换同源feed。冲突必须人工对账，不会篡改现存版本；
- 输入输出必须是不同的绝对私有路径，禁止public目录和符号链接；
- sync生成的数据可交给先前的factor:capture:once/watch（当日有效输入时）与factor:maturity:once/watch（累计历史、5交易日成熟），再交给factor:shadow:once/watch及factor:neutral:once/watch；
- 因子分数仍必须由已授权的逐票因子生产者写入，缺少两个已实际记录的扩展因子时，捕获研究信号不会自动成功。

## 实际运行和证据

这批完成的是**可用的本地协议转换、时点一致性核验与不可回写安全措施**。由于现有用户指定的WorkBuddy部署文档此前返回HTTP401，尚无法确认或执行该主机的API写入；没有有效的数据授权材料，也没有已验证的长周期真实市场因子样本，不能宣称生产自动学习已运行、或该桥接模块能提供合法付费原生实时行情。

用户下一步需要由数据提供商/本人配置（不要在聊天或仓库粘贴口令）：合法来源、收盘后原observedAt、逐票停牌和公司行为、同日候选信号时间与逐票因子评分时间。只有这三路已真实同步，preflight才可以通过本地协议；通过仍需独立检查供应商许可/时钟可靠性、部署持久卷、数据恢复及云端权限。

## 回归

    node --test tests/factor-authorized-market-bridge.test.js
    npm run check
    npm test

所有代码均为离线研究工具；四套正式策略、15个正式因子基础权重、模拟盘账本、电脑/手机锁定主页保持原样。