# 用 Windows 电脑运行天枢智策后台

> **手机不安装客户端的免费临时访问方案：** 请看 [Windows 本机 FAYO + Cloudflare 邮箱验证码](LOCAL_BROWSER_CLOUDFLARE.zh-CN.md)。先验证本机与权限，再在电脑启动临时隧道；原 Tailscale 私网方案仍可选。此文档不代表已经在手机上验收。

按照 2026-11-15 的用户要求，家用 Windows + WSL 是后台部署目标，电脑浏览器和手机都是同一后台的客户端。电脑必须开机、联网且 WSL 正常运行；关机、休眠或 WSL 停止后后台不可用。本包不购买服务器，不自动修改电源、任务计划、防火墙、VPN 或已有应用目录。

**这是一份本机部署包，不是已完成上线的回执。** 源码来自 manifest 标注的完整 Git SHA；实际 Windows/手机连接仍需在你的设备验证。当前 WorkBuddy 首页地址保留，但它与 Node 后端使用不同接口和账户，不能仅启动后台便声称无缝接通。

后台源码与启动脚本都从同一个 Git 提交读取，未提交的文件不能进入包；PowerShell/CMD 仅转换为 Windows 换行。`source.json` 同时记录 `sourceSha` 和 `controlsSourceSha`，`SHA256SUMS.txt` 覆盖每个打包文件。启动器拒绝 FIFO、硬链接或权限过宽的私有状态/日志，读取时限制实际字节数并核对文件未变更；异常时保留原状态，不覆盖账户。

## 1. 安装一次运行环境

项目使用 Linux 文件锁，所以在 Windows 通过 WSL2 Ubuntu 运行。不要直接用 Windows 原生 Node 启动。

管理员 PowerShell 执行微软官方命令：

```powershell
wsl --install -d Ubuntu-24.04
```

按提示重启，首次打开 Ubuntu 设置自己的 Linux 用户和密码。这些密码只在本机输入，不发送到聊天。已有 Ubuntu 的用户可在 PowerShell 使用 `-Distribution Ubuntu` 调用本包脚本；默认使用 `Ubuntu-24.04`，不自动选另一个发行版。

在 Ubuntu 安装基础工具：

```sh
sudo apt-get update
sudo apt-get install python3 python3-venv curl util-linux ca-certificates
```

另需 Linux 版 Node 22.6 或以上（本项目验证使用 Node 22.23.5）。已有版本可直接使用；没有时，在解压包所在的 Ubuntu 目录显式运行：

```sh
bash install-node.sh
```

这个可选脚本从 [Node.js 官方下载](https://nodejs.org/en/download) 获取固定 Linux 版本，核对官方 SHA256 后安装到当前用户的 `.local`，不使用 sudo、不覆盖已有 Node、不修改全局 PATH 或 shell 配置。初始化不会静默执行下载。`node`、`python3`、`curl`、`flock` 必须能在 WSL 的非交互 PATH 中找到。

机器学习环境另外使用独立 venv 按 `payload/tools/requirements-models.txt` 安装，并在后续模型配置中指定。此包的启动成功不代表 ML 训练已验证。

## 2. 初始化和本机验证

先核对 ZIP 的 SHA256。若 Windows 因下载来源阻止脚本，核对来源和哈希后在 ZIP 属性中解除锁定再解压；本包不修改全局 PowerShell 执行策略。

双击 `START.cmd`，按顺序选择：

1. **Initialize**：检查 manifest 和每个源码文件，再创建全新 `~/.tian-shu-local`。如果目录已存在，拒绝覆盖，保留其中账户和历史。
2. **Smoke**：初验启动，跳过后台采集；检查 HTTP、依赖、源 SHA 和本机模式。
3. **Open**：从 Windows 打开 `http://127.0.0.1:8787/`，先设置开发者密码。
4. **Stop**：停止本安装的进程。
5. **Start**：启动本机研究服务。配置仍为 replica，两个模拟盘自动运行保持关闭，没有预置外发凭据；不会接管旧云端账户或自动推送。

Smoke 会恢复本安装已保存的本地快照，但不启动行情采集或外发；历史快照仍保留原日期。健康检查的单次请求最多1秒，启动检查同时服从剩余等待时限；慢速零碎响应或中途断开会返回不健康。`health-not-ready` 后保留本安装的进程记录，可先 Status 排查、再 Stop，不自动删账户或强杀其他进程。`running` 只表示进程存在，还应检查 `health` 字段。

Stop 使用单调时钟等待至多5秒，不受系统时间校正影响；进程在检查后自行退出也可完成清理。超时或信号权限失败保留进程记录和账户，不自动强杀或重置。

Status、Start 或 Stop 返回 `process-inspection-failed` 时，表示暂时无法确认进程身份，不表示后台已停止。控制器保留原 PID 记录并释放锁；先在原 WSL 用户下检查进程读取权限及系统状态，恢复后重试 Status。不要删除进程记录或重新初始化目录来绕过检查。首次获取新子进程身份沿用原短时重试；Stop 发出停止信号后也会在原5秒预算内重核短暂不可读状态，必须确认退出才清理记录。

也可使用 PowerShell：

```powershell
.\windows-host.ps1 -Action Initialize
.\windows-host.ps1 -Action Smoke
.\windows-host.ps1 -Action Status
.\windows-host.ps1 -Action Open
.\windows-host.ps1 -Action Stop
.\windows-host.ps1 -Action Start
```

依赖和所有私有状态都留在 WSL Linux 主目录中，不放到 `/mnt/c` 共享目录。不要将整个运行目录上传 Git、聊天或公开网盘。不要只备份 `app/data`：登录、配置、模拟盘和历史还位于应用根目录等位置。**已有安装不能重新 Initialize，也不能通过 git pull 覆盖 app**；新版独立 updater 的操作见下文。账户迁移与主写者切换仍需独立核对。

## 2.1 检查更新、暂停与只读审计

启动器菜单的「Check GitHub update」默认只检查，不停止或替换当前服务。PowerShell 支持：

```powershell
.\windows-host.ps1 -Action Audit
.\windows-host.ps1 -Action Update
.\windows-host.ps1 -Action UpdateStatus
.\windows-host.ps1 -Action PauseUpdates
.\windows-host.ps1 -Action ResumeUpdates
.\windows-host.ps1 -Action WatchUpdates
```

`Audit` 只读核对已有 Windows 计划任务与 WSL systemd 服务/定时器，报告任务名称、状态和匹配数量，不输出可能含凭据的命令参数。匹配使用名称/动作关键词，**不是全系统不存在重复写者的证明**；发现其他采集、推送、账户写者时先人工核对，不自动停用它们。

`WatchUpdates` 是显式前台持续检查进程，每 15 分钟 dry-run；同一安装仅一个 watcher 可持锁。Ctrl+C 停止后续检查，并等待正在进行的 updater 安全结束。它不创建开机任务、不保证 WSL 在 Windows 注销后继续运行。完成现场验证后才可显式在 WSL 运行 `bash watch-updates.sh --apply`，仍受暂停、敏感变更和全部 updater 门禁约束；不可向 watcher 配置永久敏感变更批准。

只有完成原账户冷备、恢复预演与真实本机验收后，才显式运行应用更新：

```powershell
.\windows-host.ps1 -Action ApplyUpdate
```

涉及账本、迁移或权限等敏感代码时 updater 会拒绝默认自动放行。审阅精确候选提交后，可通过 `-ApproveSensitive <完整40位SHA>` 绑定该次批准；它不会绕过 CI、完整性、备份或启动门禁。使用非默认测试安装时指定 `-InstallationHome /home/实际用户/独立测试目录`；该参数是 WSL Linux 绝对路径，不接受 Windows 共享目录。

实现与恢复边界见仓库根目录 [SAFE_AUTO_UPDATE_OPERATIONS.md](../../../SAFE_AUTO_UPDATE_OPERATIONS.md)。源码包必须包含本次 updater 文件，旧解压包不会因 GitHub 有新代码而自动获得新启动器。**未在你的 Windows 上运行前，不视为已经启用定期更新或完成生产升级。**

## 3. 手机访问：免费个人私网

推荐电脑和手机安装 [Tailscale](https://tailscale.com/download)，加入自己的同一个私网。个人用途可选择其 [Personal 免费计划](https://tailscale.com/pricing)；不要启用付费试用或订购资源。安装和登录由你在自己的设备完成，不在本包中索取认证密钥。

先确认 Windows 本身能打开 `http://127.0.0.1:8787/`，并且已经设置开发者密码，再在 Windows 终端按 [Serve 官方文档](https://tailscale.com/docs/reference/tailscale-cli/serve) 配置：

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

配置后运行只读核对：

```powershell
.\windows-host.ps1 -Action NetworkStatus
```

此核对先确认 Windows 回环能读取 V6 身份门禁且已设置密码，再检查私网 HTTPS 仅代理 `http://127.0.0.1:8787`。存在 Funnel、其他代理目标、额外转发、明文 TCP 或前台会话时拒绝认可；只报告结果，不修改现有 Tailscale 配置，也不输出私网主机名。Tailscale 版本若返回不兼容结构会安全拒绝，需按实际 CLI 状态人工核对。

按官方提示启用 HTTPS，手机连接自己的 Tailscale 后打开它生成的专属 HTTPS 地址。这里使用仅限自己私网的 **Serve**；不启用公开互联网的 Funnel，不开放路由器端口，也不把服务改绑 `0.0.0.0`。

手机实际访问、登录、断网重连及关闭浏览器后的采集都必须现场验证。WSL 内 `curl` 通过不等于 Windows 或手机通过。Serve 不是进程守护，不能保证 Windows 重启后 WSL 自动运行。

**首次测试先保持一个 Ubuntu 窗口打开（可以最小化）**。本包没有安装 Windows 计划任务或 systemd 自启动，尚未验证关闭所有 WSL 窗口后后台仍存活；不要仅凭电脑没有休眠就认定后台持续运行。完成本机实测后，再配置登录自启动、故障重启及重启恢复验证。

## 4. 与当前 WorkBuddy 页面的关系

当前入口仍为 `https://af3c7822e6aafc135.app.workbuddy.host`。本机 Node 页面与其数据接口、登录、SSE 及账户结构不同，不能直接换一个接口地址，也不能将分享码变为后端管理员令牌。

首次只在专属私网地址验证后台。随后才实现原页面的数据适配，并测试 HTTPS、精确来源 CORS、浏览器私网访问权限、手机订阅和撤权。若浏览器限制原页面直接访问私网，先从入口跳转到专属私网页面，不关闭浏览器安全设置。

原云端账户仍是原账户，本机是全新的独立安装。迁移之前须停止旧写者、保留完整备份、核对余额/持仓/历史和恢复路径；不能双写。

## 验收状态

交付报告分别记录源码 SHA、包哈希、脚本测试、本机 Linux 隔离启动、Windows localhost、手机 HTTPS、关浏览器持续采集、重启持久化及恢复。未现场验证的项目保持未验证。

参考：[微软 WSL 安装](https://learn.microsoft.com/windows/wsl/install)、[WSL 的 systemd](https://learn.microsoft.com/windows/wsl/systemd)、[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)。
