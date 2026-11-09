# V6 黄色四项统一返工｜2026-11-09

基线 `dev`: `23e8018a96ab392ae50dbc31ed1cc71f4e293b9f`。不覆盖四套正式策略、模拟盘账本、旧审计及电脑/手机已有布局。

## ① 行情真实性
`npm run market:diagnose -- 600001` 会在北京时间常规工作日 09:30–11:30 或 13:00–15:00 只做一次腾讯与东财公开报价探测。
两家都必须有真实来源原始时点（各不超过15秒），价格相差不得超过50基点。节假日尚未经交易所日历认证；连续真实采集、授权及商业展示权限也仍需现场验证。不绕过403，不开启高频网络采集，诊断不参与下单。

## ⑤ 观察池与风险提醒
保留 `npm run research:eight -- input.json --watch-state /private/watch.json` 的本机跨日观察池。新增 `npm run risk:notify -- /private/holdings.json /private/receipt.json [--send]`。
默认只做干跑，不发送。启用时须同时设置 `V6_FEISHU_WEBHOOK` 为个人自己的官方飞书机器人 HTTPS 地址，`V6_RISK_NOTIFY_CONSENT=YES` 并显式带 `--send`。
只发送严重/普通风险数量与未知数据数量；不发送股票代码、成本、股数、报价、账户或密钥。过期报价不会触发价格预警。先写私有去重状态再发网络请求，超时或断连不能自动重发。`gateway-accepted` 只是机器人网关接受，并非证明手机已经收到；仍需终端实际验收。

Windows PowerShell 示例：
```powershell
cd V6_BO
npm run risk:notify -- "C:\V6-private\holding-watch.json" "C:\V6-private\feishu-receipt.json"
$env:V6_FEISHU_WEBHOOK = "你自己创建的官方飞书机器人地址"
$env:V6_RISK_NOTIFY_CONSENT = "YES"
npm run risk:notify -- "C:\V6-private\holding-watch.json" "C:\V6-private\feishu-receipt.json" --send
```
私有状态文件损坏、残留锁或软链接均拒绝发送，必须人工检查；不能因为未知发送结果就删除记录后重发。

**后续加固（跨重启连续巡检）：** 同一交易日的A→B→A风险摘要现在保留全部去重指纹；同日最多12条不同摘要，同级别两次发送至少间隔120秒。新增一份兼容旧格式的私有去重流水，不能用于验证手机消息已读。 旧v1回执缺少股票级指纹信息，同风险类别与数量可能保守地视为重复；这时必须由用户在本机核对，不通过删除旧回执来强行重发。新v2流水使用私有事件ID的哈希解决后续同类不同票的区分。

```powershell
# 默认只检查一次、不会联网发送
npm run risk:monitor -- "C:\\V6-private\\holding-watch.json" "C:\\V6-private\\feishu-receipt.json"
# 在你自己电脑显式配置上述两个环境变量后，才可长期启动5秒一次本机巡检
npm run risk:monitor -- "C:\\V6-private\\holding-watch.json" "C:\\V6-private\\feishu-receipt.json" --monitor --interval-ms 5000 --send
```

这不是实时采集器。每轮会重新读取本机私有JSON（必须由用户授权的数据进程持续更新），缺失或过期报价不会补写新的价格。运行实例使用独立排他锁，异常崩溃留下的锁必须由用户核实无其他进程后处理；不会自动删除。长期巡检需保持电脑在线或自行按运维策略部署，不是本次ChatGPT在后台持续运行。不要把真实数据或Webhook写入仓库。

## ⑦ 回测与自动学习
基于现有冻结5日回测、成本、三窗口隔离、连续去重与市场阶段评审，自动生成**研究层**候选优先级：多窗口一致偏强 +3%，偏弱 -3%，证据不足或市场急跌保护则 0%。这只是有上限的研究假设，不是经认证的超额收益。
输出在 `eightPointFlow.dimensions.learning.sandboxPriorities`，具有阻断原因；不改变正式四策略、15因子、现有评分、模拟资金或真实下单门禁。正式自动晋级仍需要独立样本外验证与人工核准。

## ⑧ 手机/电脑界面
`/research.html` 共用的响应式研究页显示四项当前验收状态和学习候选数量。维持旧页面、样式、PWA入口和原有账户操作，新增脚本缓存版本。
CI会检查源码、桌面/手机页面DOM以及网页构建，但不能替代 iPhone Safari、Windows Chrome 的真机触控、视觉、认证与网络测试。

## 本批自动回归
```bash
cd V6_BO
npm run check
npm run test:yellow-four
node --test tests/eight-point-flow.test.js tests/research-explanation-ui.test.js
npm test
cd ../V6_WEB
npm ci --ignore-scripts
npm run build
npm test
```
所有外网行情与机器人响应在CI中均被模拟，不会真正发送，也不得因此宣布真实网络通了。

## 仍需外部环境才能完成的现场验收
行情合法授权与连续可用；真实飞书凭据和手机收到的实测；正式策略晋级的样本外与审批；中国大陆服务器、HTTPS、域名、恢复与电脑手机真机操作。缺这些条件，代码可以通过回归，但这四项不能标为生产完成。
