# V6 因子研究闭环第二段：冻结后的跨日成熟观察自动汇总（2026-11-10）

## 与上一阶段如何衔接

PR #60 的 factor:capture:once/watch 已实现：仅在收到**当日真实存在**的选股快照、未复权收盘快照及逐票来源/时间戳有效的扩展因子评分之后，自动持久冻结 cohort、features 和 SHA256 捕获回执。

本次新增 factor:maturity:once/watch，以原始冻结批次为输入，在操作人员已授权提供、持续更新的**同源历史市场JSON**中跟踪这些股票的5交易日后收盘表现，借助既有 forward-tracking-store 的单写入/不可变历史归档能力，自动生成影子学习 worker 可消费的跨日 manifest。

具体流程：

1. 只扫描 captureDir 中已经存在的 receipt-YYYY-MM-DD.json；回执对应的cohort和features必须指纹相符、同日冻结且通过原信号协议重算。尚未写完回执的部分文件不算训练日期。
2. 读取市场生产者写入的 approved-market.json：schemaVersion=1、feed.source=imported，完整同源 feed 包括 provider、datasetId、priceBasis=unadjusted；含当前截至日期、收盘时间、显式交易日历、逐票未复权日线、停牌和公司行为。最多500只股票，当前输入JSON上限4MiB，超过需要授权生产者按范围分批，不得改成不受限的大文件或从网页偷偷补价。
3. 每日按原cohort股票代码限定市场价格，调用原 runOnce 持久更新其观察归档。之前已经成熟的价格若被改价/回退会被原门禁拒绝。采集过程未授权的市场来源/漏股或归档损坏会中断这一轮，不可悄悄跳过坏股票或以0收益补齐。
4. 严格按显式交易日历判断第五个交易日是否实际结束，允许缺价、停牌或公司行为窗口保持“未知/不计算”，但不拿这些数据充当有效收益。**首次所有信号的H5观察窗口到期**时，从该批次的 forward-tracking-history 选取最早的经过SHA256、审核重算验证的不可变观察版本。
5. 发布私有的 manifest-current.json，里面只含原 frozen features 路径与**首次到期历史观察文件**路径。manifest-history 下同步保存按证据指纹命名、不可覆盖的同一份清单。新的市场日线不会反复改写该清单过去的成熟观察版本。
6. 现有 factor-shadow-worker.js 在新版本中支持上述封存的 forward-tracking-snapshot 格式，取出报告前重算归档SHA和规则审核；仍兼容明确提供的原始离线观察报告。manifest带完整性指纹时也必须通过重算才允许学习。

## 使用方法（全部路径为服务器上的示例）

先启动 PR #60 输入捕获任务。注意以下两个后台任务只会读取**事先有权取得的数据**，不会自动购买、登录、爬虫、拉取未知来源数据：

    npm run factor:capture:watch -- /srv/v6-private/picks-current.json /srv/v6-private/eod-current.json /srv/v6-private/factors-current.json /srv/v6-private/daily-captures --interval 30000

市场供应商/合法导入任务持续**原子写入**准许使用的 approved-market.json 后，运行：

    npm run factor:maturity:once -- /srv/v6-private/daily-captures /srv/v6-private/approved-market.json /srv/v6-private/tracking /srv/v6-private/manifest-current.json

或配置独立唯一的观察汇总进程：

    npm run factor:maturity:watch -- /srv/v6-private/daily-captures /srv/v6-private/approved-market.json /srv/v6-private/tracking /srv/v6-private/manifest-current.json --interval 60000

最后，现有因子学习进程以同一个manifest目录运行：

    npm run factor:shadow:watch -- /srv/v6-private/manifest-current.json /srv/v6-private/shadow-models --interval 60000

自此三个**独立的研究进程**组成受控数据链：有真实已授权当天资料时才冻结；有未来第5交易日价格时才成熟；有足够至少36个真实日批次、持续性/市场环境/样本外门禁通过时才尝试更新影子研究权重。

若只有1～35个成熟日，manifest可以作为只读审计材料保存，但影子模型不会升权；需要更充足、有效的样本日才能进行训练。周末没有新的实际交易日，不推进交易日步数，不执行模拟交易。

## 安全与局限

- 三类数据来源都须由外部有合法授权的采集/导入工作流产生，本批**没有**接通任何实际A股供应商许可，也没有验证 WorkBuddy 的部署写入能力，因此不能声称已部署/在线自动运行。
- Manifest 当前文件只是研究索引，会原子换成较新版本；其历史版本及已成熟5日观察文件不覆盖。先验信号/因子回执不可重写，市场来源切换或历史价格修订必须人工对账，不能直接无声用新历史替代旧训练标签。
- 不能因为报告中出现 imported、verifiedLive:false 或数据指纹就把价格变化说成含手续费的净收益/样本外模型盈利。因子生产仍依赖外部有时点证明的真实分数，不会补造15项扩展因子。
- 模型晋级仍由前述PR #59的研究沙盒进行，不修改生产策略配置、不开放下单API、不接券商实盘、不更改模拟盘、账户、飞书或手机/电脑主页。
- 工作进程与主服务还需共享真正私有持久卷、单实例运行、日志/备份/时钟同步；实际云端需有人工验收。

## 回归

    node --test tests/factor-maturity-link.test.js tests/factor-evidence-capture.test.js tests/factor-shadow-evolution.test.js
    npm run check
    npm test

专项测试应覆盖：第五交易日前不得生成成熟表现、缺价/中断不得猜收益、历史归档被篡改必须失败、已成熟五日证据固定在最早版本、manifest同证据幂等、网络不参与、研究权重与账户完全不变。
