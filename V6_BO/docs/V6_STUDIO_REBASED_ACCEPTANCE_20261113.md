# 独立 Studio 与市场雷达原型重基线验收（2026-11-13）

本次基线为 `a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47`。从历史 UI PR #166/#169
只恢复独立 `public/v6-*.html`、专属 CSS/JS、六条件分页快照及其回归测试。
没有移植历史 AGENTS 变更、自动更新/发布脚本；两张锁定主页、正式 `/picks.html` 和根导航不变。

## 使用范围

六个直接 URL 是 `/v6-studio.html`、`/v6-matches.html`、`/v6-research.html`、
`/v6-validation.html`、`/v6-paper.html`、`/v6-market-radar.html`。
这是独立验证原型，不是原主页替代品，也没有获得用户原图或真机满意度认证。
只读页面没有新增扫描、下单、发通知、发布或账户修复动作。

候选来自完成的一次 `quantPicksScan`，在原最多50条响应截断前冻结。
`GET /api/v6/matches` 走既有数据权限门禁，只分页读取内存快照；没有快照就返回 `not-ready`，
前端不会转调 `quant-picks` 进行初始化。旧扫描器和正式入口的行为不在此改动。
服务重启后内存快照为空，须等待原有业务路径完成下一次扫描。

`scope=quant-picks-six-rules` 指六项量化条件，`completeForScope` 只表示该次扫描的全部命中可分页读取。
它不代表其他四套策略、其他战法或全 A 股历史/实时全覆盖。
`coverage.candidateUniverse=server-available-stocks`、`fullMarketCertified=false`、
`allStrategyEngines=false` 保留这个边界；条件5缺板块证据时明确 `not-evaluated`。
扫描生成时刻不充当逐票报价时刻；缺少来源或原始时间时页面显示未知。

## 实质修正

- 移除旧原型快照未就绪时自动调用 `quant-picks` 的行为；也移除会被只读门禁误匹配的旧注释。
  全部真实浏览器 API 请求记录均为 GET，令牌只放既有 Bearer 认证头，不出现在 URL。
- 读取过程中快照 ID、数量或时点变化立即拒绝混合；游标损坏、重复证券、信号总数不一致都不展示伪完整结果。
- 刷新开始和失败都清空旧候选与详情；无权限、撤权响应、令牌变化、离线或页面隐藏都会清空已显示结果。
  模拟账户默认不读，须用户点击；每次点击先清空，权限失败不保留旧私密余额。
- 切股取消旧请求并使用序号守门，避免旧 K 线覆盖新票。复用现有 `/api/kline` 排他日期游标，
  最多读取5页、1200根，月/年由已返回日线聚合，首尾周期可能不完整时明确提示，不填补交易日。
- 兼容 `dataQuality.source` 等来源元数据；雷达按真实 `reference-indexes.items` 的
  `sh/sz/cyb/kc50` 对象读取，科创50不会误写成 A50，接收时点不充当报价时点。
- 页面仅加载其专属样式和脚本，没有发布控件或对主页共享资源的覆盖。

## 实际验证

定向 Node 测试：`v6-matches-snapshot`、`v6-studio-new-ui`、`picks-three-k`、
`picks-page-cloud-readonly`、`dashboard-view` 共27项通过，无失败、跳过或取消。
包含临时目录中的真实 server 启动、实际编辑登录/观看申请审批、匿名/观看私密账户拒绝、
设备撤权后新 API 拒绝，以及完整250只候选/500条件的固定快照分页。
测试只复制程序文件，使用合成状态与合成口令；子进程拒绝外部网络，不读真实账户或行情采集。

浏览器复现命令：

```sh
V6_STUDIO_BROWSER_OUTPUT=/tmp/studio-qa \
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules \
node scripts/ui-v6-studio-browser-check.js
```

使用实际 `/usr/bin/chromium`，三个 CSS 视口320×740、390×844、1440×1000，
逐页截图并核对文档无横向溢出。额外验证完整分页、601根历史 K 线、日/月/年切换、
切股延迟竞态、断网清除/重新读取、刷新失败清除和真实服务端撤销设备后私密值清除。
9组检查通过，23张截图、69次浏览器 API 请求全部为 GET；截图和请求日志写入 `studio-browser-report.json`。
本次原始日志和截图目录为 `/workspace/remaining-output/studio-browser`，
定向日志为 `/workspace/remaining-output/studio-targeted.tap`。

没有运行真实数据采集、对外通知、部署、合并远程 PR 或修改正式主页。
**原图1:1、iPhone Safari/Android真机、线上 WorkBuddy 访问和真实行情时效验收未完成。**
本地 Chromium 与合成 HTTP 测试不能替代这些验收。回滚使用本提交的 `git revert`。
