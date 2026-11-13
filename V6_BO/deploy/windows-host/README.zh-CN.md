# 用 Windows 电脑运行天枢智策后台

这是可选的本机部署与验收工具，不替代手机、电脑独立访问同一云端的目标。选择此模式时，电脑负责运行后台，手机作客户端；电脑必须开机、联网且不休眠，关机或 WSL 停止后后台采集也停止。本包不购买服务器，不自动修改电源、任务计划、防火墙、VPN 或已有应用目录。

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

也可使用 PowerShell：

```powershell
.\windows-host.ps1 -Action Initialize
.\windows-host.ps1 -Action Smoke
.\windows-host.ps1 -Action Status
.\windows-host.ps1 -Action Open
.\windows-host.ps1 -Action Stop
.\windows-host.ps1 -Action Start
```

依赖和所有私有状态都留在 WSL Linux 主目录中，不放到 `/mnt/c` 共享目录。不要将整个运行目录上传 Git、聊天或公开网盘。不要只备份 `app/data`：登录、配置、模拟盘和历史还位于应用根目录等位置。此版本不会自动升级或迁移已有安装，避免替换源码时丢失状态。

## 3. 手机访问：免费个人私网

推荐电脑和手机安装 [Tailscale](https://tailscale.com/download)，加入自己的同一个私网。个人用途可选择其 [Personal 免费计划](https://tailscale.com/pricing)；不要启用付费试用或订购资源。安装和登录由你在自己的设备完成，不在本包中索取认证密钥。

先确认 Windows 本身能打开 `http://127.0.0.1:8787/`，并且已经设置开发者密码，再在 Windows 终端按 [Serve 官方文档](https://tailscale.com/docs/reference/tailscale-cli/serve) 配置：

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

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
