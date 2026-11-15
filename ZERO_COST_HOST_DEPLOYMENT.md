# 家用 Windows / WSL 免费私网部署

基线：`dev@e113e96e2fb9f5300b54809b9450427a745ca464`，需求来源为 PR #277 的 2026-11-15 交接。本文记录实现和验收边界，不是用户电脑已上线的回执。家用机承担唯一后台，手机和电脑浏览器从同一实例读取账户、持仓、研究和历史；浏览器不是权威账本。

## 已实现与现场阻塞

| 项目 | 状态 | 可核验依据 |
| --- | --- | --- |
| 精确 Git SHA 完整运行包、manifest 哈希、本机副本初始化 | DONE（已有能力保留） | `V6_BO/scripts/build-windows-host-bundle.py`、`deploy/windows-host/host-runtime.js` |
| Windows 启动器更新检查、状态、暂停/恢复和显式应用入口 | DONE（源码）；Windows 运行待验证 | `windows-host.ps1`、`update.sh`、独立 updater |
| Windows 任务及 WSL 服务的只读审计 | DONE（源码）；Linux 审计已运行 | `-Action Audit`；Windows Task Scheduler 不在当前环境 |
| Tailscale 私网 HTTPS 配置核验 | DONE（确定性测试）；手机实连 BLOCKED | 6 项 validator 测试，拒绝 Funnel、公开/非回环代理、额外路由和无效状态 |
| 用户原账户无损迁移与完整恢复预演 | BLOCKED | 当前环境无权访问用户 Windows/WSL 原私有目录 |
| Windows Edge、手机 Safari/Chrome、重启后恢复 | BLOCKED | 当前环境没有这些真实设备及 Tailnet 会话 |
| 本机定期自动更新、故障通知和 24 小时运行 | PARTIAL | 提供唯一 watcher 默认检查/显式应用；未在用户电脑启用开机调度或验证通知/长期运行 |

未购买服务器、付费试用、行情、模型或其他资源。未创建第二个 WorkBuddy 发布者，未修改路由器、防火墙、电源或 VPN。用户电脑睡眠/关机、WSL 停止、家庭网络断开时完整后台不可用。

## 先检查已有环境

在 Windows PowerShell 读取 `wsl --list --verbose`，核对现有 Ubuntu 发行版。已有 WSL2、Ubuntu 24.04、Linux Node >=22.6、Python3、curl 和 flock 时直接复用，不重复安装。仅在缺少工具且明确选择安装时按 [完整启动器说明](V6_BO/deploy/windows-host/README.zh-CN.md) 的官方来源步骤操作。

在**新的解压包**中运行：

```powershell
.\windows-host.ps1 -Action Audit
.\windows-host.ps1 -Action Status
```

默认发行版为 `Ubuntu-24.04`；实际安装名不同需显式添加 `-Distribution Ubuntu` 等实际名称。脚本不会悄悄改用另一个发行版。`Audit` 只显示匹配的任务名称、状态和单元名称，不打印包含凭据的执行参数；关键词匹配不保证发现所有其他写者，现场仍需核对原部署。

## 账户与服务保持单一

`Initialize` 只适用于全新隔离目录，已存在目录会拒绝覆盖。用户已有目录不得重新初始化或直接覆盖 `app`。首次现场迁移需停止全部旧写者，冷备**整个**运行目录（包括根配置/登录设备、权威订单、审计、新闻研究档案和缓存），校验清单并恢复到独立目录预演，核对账户/持仓/订单后再决定切换。

测试和新安装维持 `pushRole=replica`、自动模拟盘关闭、无外发凭据，不连接券商实盘。两浏览器读同一后台不等于两个任务主实例。是否正式启用主采集和推送必须独立验证，不能通过改配置绕过唯一写者检查。

## Windows 与手机逐级验证

1. 在独立安装运行 Smoke，检查依赖、源 SHA、HTTP 和 replica 状态。Smoke 跳过后台采集，不代表真实数据源已接通。
2. 在 Windows 运行 Open，确认 `http://127.0.0.1:8787/`，在页面设置自己的开发者密码；密码不提交 Git 或聊天。
3. 电脑和手机使用自己的同一 Tailscale 私网，选择其 Personal 免费方案，不接受付费试用。安装/登录需设备所有者在各自设备完成。
4. 在 Windows 执行下列 Serve 命令；不启用 Funnel，不开放路由器端口，不将 Node 改绑 `0.0.0.0`。

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
.\windows-host.ps1 -Action NetworkStatus
```

5. 手机连接自己的 Tailnet，打开 Serve 生成的专属 HTTPS 地址，再验证登录、只读、设备授权/撤权、同一账户余额/持仓/订单版本。私网和 TLS 不能代替应用身份门禁。手机查看 `/m` 与电脑 `/` 应来自同一服务实例。
6. 分别关闭另一端浏览器、关闭所有浏览器后检查后台任务仍运行；断网后恢复并确认无重复推送、旧报价未冒充实时、新闻与行情时间独立显示。

`NetworkStatus` 成功只证明 Windows 回环身份门禁和单一私网 HTTPS 代理配置，**不证明手机已连接**。它会拒绝 Funnel、非回环/错误端口、明文 TCP、其他路径和前台会话；现有配置不兼容时保持原配置，人工查明后再调整，不自动 reset。

## 重启与调度

先保持一个 Ubuntu 窗口打开完成首次验证。Tailscale Serve 不守护 Node，也不保证 Windows 重启会启动 WSL。配置 Windows 计划任务或 WSL systemd 前，应保存 Audit 结果，核对没有其他更新器、采集器或推送主实例，完成真实重启/恢复/回滚验证后再启用唯一任务。

当前没有用户 Windows 权限，因此没有创建、开启或修改任何计划任务，没有修改休眠设置。实际启用后的任务间隔、最近运行、失败通知、停用和恢复必须保存在用户私有操作回执中。更新暂停不等于停止后台；后台 Stop 也不等于停用计划任务。

可先显式运行 `windows-host.ps1 -Action WatchUpdates`：每 15 分钟仅检测，默认 dry-run，独立内核锁拒绝重复 watcher。WSL 等价为 `bash watch-updates.sh`；完成上述本机验证后，`bash watch-updates.sh --apply` 才允许满足全部门禁的候选自动应用。Ctrl+C / SIGTERM 停止后续轮次，等待正在进行的事务结束，不在切换中直接杀 updater。此进程不等于 Windows 开机自启动任务；当前未启用用户调度。

## 私有回执模板

在用户电脑的私有目录保存：操作时间、Windows/WSL 版本、源码 SHA/包 SHA256、原安装路径（不公开）、唯一写者核对、备份/恢复预演结果、Windows HTTP/身份、手机 HTTPS/身份/余额一致性、关浏览器持久运行、Windows 重启、断网重连、设备撤权及回滚结果。未完成项目写 `BLOCKED` 或失败原因，禁止预填成功。

WorkBuddy 是独立静态站，HTTP 200 不证明完整 V6 后台、账户迁移或长期运行。免费私网地址直接访问完整后台，无需把本机 API 暴露为公网上无保护接口。
