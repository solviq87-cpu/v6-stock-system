# V6 因子研究：收盘后安全执行与断点恢复（2026-11-10）

## 当前缺口

既有V6的行情转换、来源预检、收盘后因子冻结、5日成熟跟踪、行业中性报告和影子模型都能独立调用，但缺乏一个严格排序、默认不写入的入口。本次新增单次研究编排：在本地或操作者已经获得权限的云端运行已有离线模块；不调用网络行情、不安装后台任务、不接订单，也不能证明WorkBuddy实际部署或BaoStock商业授权。

## 配置（私有JSON，严禁账号/Token/分享码）

文件例如 /srv/v6-private/research-config.json，字段如下。所有路径都必须是不同的私有绝对路径，不能通过符号链接或/public发布研究数据，写入目录不能相互嵌套。

    {
      "schemaVersion": 1,
      "mode": "v6-factor-daily-research-cycle",
      "researchOnly": true,
      "canTrade": false,
      "historyFile": "/srv/v6-private/source/history.json",
      "picksFile": "/srv/v6-private/source/picks.json",
      "factorsFile": "/srv/v6-private/source/factors.json",
      "marketFile": "/srv/v6-private/research/market-current.json",
      "captureDir": "/srv/v6-private/research/captures",
      "trackingDir": "/srv/v6-private/research/tracking",
      "manifestFile": "/srv/v6-private/research/manifest-current.json",
      "neutralDir": "/srv/v6-private/research/neutral",
      "modelDir": "/srv/v6-private/research/shadow"
    }

配置不接受额外字段（尤其不能将密钥混入研究配置）；来源文件必须是既有严格校验的operator-imported EOD历史数据、同日实际选股结果和逐票因子证据。

## capture：信号当天16点后、5分钟因果窗口内冻结

先用不写文件的预览检查：

    npm run factor:daily:cycle -- capture /srv/v6-private/research-config.json

预览要求历史数据的asOf为北京时间当天、上游采集时间真实记录且距当前时间不超过15分钟、未复权、32个以上交易日真实OHLCV、显式停牌状态和公司行为日期，同时必须满足原有factor:source:preflight的近5分钟同日候选及逐票真实因子条件。

操作者**检查数据使用权及私有数据安全之后**，显式运行一次：

    npm run factor:daily:cycle -- capture /srv/v6-private/research-config.json --apply

先由authorized-factor-market同步合法输入，再由factor-eod-capture冻结当前信号及原生因子得分；之后factor-maturity-link更新H5首次成熟归档，factor-horizon-neutral更新多周期研究结果。达到至少36个成熟交易日才尝试调用factor-shadow-worker，最终是否接收影子模型仍由原有训练/验证/样本外门禁决定。绝不自动更改正式15因子、四套策略、模拟盘、账户或实盘交易。

## observe：只观察已有冻结信号，不产生新历史信号

运行同样是默认预览：

    npm run factor:daily:cycle -- observe /srv/v6-private/research-config.json

显式运行一次：

    npm run factor:daily:cycle -- observe /srv/v6-private/research-config.json --apply

必须已存在不可变的原信号归档，且新行情来自同一数据提供者及同一datasetId；源文件asOf须是今天、采集完成时间距现在不超过8小时。若今天无有效收盘数据，则skip，不将昨日缓存当成今天行情，不能回填旧信号。这个模式只更新观察和研究结果。

## 失败与重启

执行前每个输入及写入路径都要通过私有路径检查；有跨进程互斥锁，遇到已运行或残留锁则拒绝启动，不能抢占。每个原有模块都拥有自身不可覆盖的证据和历史版本控制。如果执行在中间失败，下游流程停止，已经完成的归档不会被自动删除；操作者先核对再重试相同证据，原有不可变回执及历史价格门禁保证不会默默重新写入之前的答案。

这不是跨文件数据库事务，不承诺失败后自动全部回滚。所有输出继续注明providerRightsIndependentlyVerified:false、canTrade:false、productionWeightsChanged:false；预览与成功只表示本地格式和条件被验证，不保证真实供应商授权、日线及时性、模型收益或WorkBuddy持久服务。

## 验证

    npm run test:factor:daily
    npm run test:factor:chain
    npm run check
    npm test

合成数据回归涵盖预览零写入、同日5分钟因果门禁、H5成熟前后、同证据幂等重试、旧价合理篡改拒绝、单写锁阻断与来源冲突。电脑和手机两张锁定主页不修改，原四套正式选股策略、基础15因子权重及模拟账本不修改。
