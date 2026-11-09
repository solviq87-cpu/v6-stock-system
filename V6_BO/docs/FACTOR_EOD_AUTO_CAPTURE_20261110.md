# V6 因子研究：自动冻结已有评分证据（2026-11-10）

## 目标、能力与边界

这是现有扩展因子评分器与已合并的 5 交易日自主研究引擎之间的**证据桥**，不是新增一套猜测因子。用户明确要求智能因子持续学习，本批优先解决“策略评分当时已存在，却没有将它连同来源和时间戳交给冻结研究模块”的缺口。

本次不购买或抓取任何未经授权数据；也不声称数据由交易所独立认证。来源填 source=imported 仅表示采集者明确导入了数据，实际许可、来源真实性、时点完整性仍须生产部署时验收。没有有效评分证据时拒绝，不默认为0分、50分或从K线猜分数。

输入一：现有 GET /api/quant-picks 在北京交易日16:00以后5分钟内即时产生并保存的候选JSON（含命中规则ID、原始命中说明和asOf）；不能拿今天的候选池反造历史信号。

输入二：原有 forward-signal-observer 能消费的授权导入、同日未复权收盘行情JSON（含真实交易日历、收盘价、逐票停牌/公司行为记录）。价格基准只能来自这里。

输入三：已有扩展因子逐票评分快照JSON（必须由独立获授权的数据提供方安全写到私有路径）。字段：

- schemaVersion=1，feed={source:"imported",provider:"授权来源标识",datasetId:"不可混淆的数据集版本"}，asOf 是当时的**毫秒整数**时间戳，且不晚于第一个输入的候选 asOf。
- rows 至少覆盖所有候选股票，每只示例：
  {code:"600001",feed:{source:"授权来源标识",timestamp:当时毫秒时间戳},sectorHeatScore:67,leaderStrengthScore:44,factorEvidence:{sectorHeatScore:{source:"授权来源标识",timestamp:当时毫秒时间戳,code:"600001"},leaderStrengthScore:{source:"授权来源标识",timestamp:当时毫秒时间戳,code:"600001"}}}
- 例子里的67和44仅用于说明协议，不是A股实测值；不得复制到正式快照或报告。
- factorIds 可选，如 ["sector_heat","leader_strength"]；未指定时，只自动挑选**全部候选逐票均可证实**且已在现有因子包登记的因子；至少两项才能启动学习。每项都必须有0至100实测分数、相符的逐票来源/时点证据，模拟、跨股票和未来数据不得用。最多追溯24小时且只能来自同一交易日。
- 可选 marketContext 使用现有信号时刻市场环境门禁；没有可靠证据只能标记unknown，不事后倒填历史指数。
- 同股不同命中规则在cohort里是独立信号，但后续IC训练仍防止同股同日重复计数。

## 自动捕获与产物

在 V6_BO 工作目录、已准备好三份独立私有文件且已挂载可靠私有卷的条件下，单次：

    npm run factor:capture:once -- /srv/v6-private/picks-current.json /srv/v6-private/eod-current.json /srv/v6-private/factors-current.json /srv/v6-private/daily-captures

或由运维明确启用独立进程循环检查已经由合法来源原子更新的文件：

    npm run factor:capture:watch -- /srv/v6-private/picks-current.json /srv/v6-private/eod-current.json /srv/v6-private/factors-current.json /srv/v6-private/daily-captures --interval 30000

每次只允许在信号发生的**当天真实冻结**；自动产生三份0600权限的不可覆盖文件：

1. cohort-YYYY-MM-DD.json：同日冻结候选及授权收盘基准，完全沿用原冻结协议。
2. features-YYYY-MM-DD.json：逐信号因子值、当时评分证据、因子版本与cohort指纹，不含原供应商私密payload或密码。
3. receipt-YYYY-MM-DD.json：生成时点、三份原始输入的SHA256组合指纹以及两份冻结文件指纹；最后发布。

同日重复输入返回 already-frozen-identical，不会以新时间重造同一天的冻结记录。原输入变更、证据损坏或文件冲突拒绝覆盖。单写入锁阻止并发，异常中断遗留锁需人工核查。若崩溃只写出部分文件，可在原五分钟有效时段内用**相同输入/相同时钟条件**恢复；超过时段只能人工审计，不能回填一个假的历史时点。

## 尚待完成

这只是已存在有效来源分数的受控捕获和时间戳归档，**不是**无账号自动连通实时行情、无需授权的网络采集，也没有神奇地计算缺失的15种因子。还需要将每个历史信号的跨交易日成熟观察报告安全聚合成版本化manifest，交给 factor:shadow:watch 学习；需要长期许可、独立来源与WorkBuddy官方部署写权限验证后才能宣称全天自动运行。

## 验收

    node --test tests/factor-evidence-capture.test.js
    npm run check
    npm test

不能修改原电脑/手机主页、四正式策略、模拟盘账本或生产因子权重。仅研究沙盒运行，canTrade始终false。
