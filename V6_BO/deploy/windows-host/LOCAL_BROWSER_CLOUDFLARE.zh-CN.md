# 绯曜 FAYO V6｜Windows 本机优先、手机浏览器免装 App

**目标：不买云服务器、不删除原历史、不部署 Streamlit 简化版。** 在 Windows + WSL 启动现有完整 V6/FAYO Node 后端；手机如果需要异地访问，再做经过安全门禁的 Cloudflare Tunnel 临时预览。本文不是“已在用户电脑上线”的回执。

## 一、在 Windows 本机运行完整 FAYO

1. 在 GitHub 仓库 `solviq87-cpu/v6-stock-system` 的 **Actions → V6 Windows One-Click Desktop** 中选择已通过全部作业、提交等于所需 `dev` 精确 SHA 的最新运行。
2. 在运行的 Artifacts 下载 `TianShuV6-Native-Setup-EXE`（或 `TianShuV6-Windows-OneClick`）。前者解压后运行 `TianShuV6-Setup.exe`，后者按 `README.zh-CN.md` 使用 Windows 入口。核对随包 SHA256，不能只凭文件名判断版本。**这是运行所需包，不是所有历史源码与账户数据归档。**
3. 如果电脑已有 V6/WSL 安装，先在原安装运行 `Status` 和 `Audit`，确认账户、历史与唯一运行实例；**不要重新 Initialize / 重装覆盖 / 清空账户**。新安装先执行隔离 Smoke，不导入旧数据、不启动交易或外发推送。
4. Windows 首次安装通常需要 WSL2 Ubuntu；首次配置过程可能要求 Windows 授权和重启。输入的 Linux 与 V6 登录密码仅留在本机。
5. 服务健康后，在电脑浏览器打开 **http://127.0.0.1:8787/**，确认是真正的 **绯曜 FAYO**、登录/设备授权有效、行情显示原来源日期。运行控制器默认 `QD_CLOUD=1`、`HOST=127.0.0.1`、`pushRole=replica`，避免本机免密和重复推送；不要改成 `0.0.0.0`。

## 二、手机不安装客户端：Cloudflare Quick Tunnel（先做短时测试）

**前提：完成步骤一的真实登录验收**，且 Windows 本机的 `/api/lock/status` 显示已有密码，未授权请求不能获得编辑者数据。Quick Tunnel 是临时预览，不能视为完整生产上线。

1. Windows PowerShell 安装（只装在电脑，**手机无需安装**）：
   ```powershell
   winget install --id Cloudflare.cloudflared -e
   ```
   重新打开 PowerShell 后确认 `cloudflared --version`。若已安装，就不必重装。
2. Windows 本地仍能打开 `http://127.0.0.1:8787/` 后，执行（换成你自己的邮箱，**不要把邮箱/验证码/登录密码上传 GitHub**）：
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:8787 --allowed-mail "your-own-email@example.com"
   ```
3. 终端成功时会打印一次性的 `https://随机名称.trycloudflare.com`，用手机 Safari 打开，经允许邮箱的一次性验证码后，再完成 V6 自身的登录和设备验证。
4. **一旦出现 403 来源不一致、账户权限异常、未授权可看到管理员功能、页面漏敏感数据或身份撤销不生效，立即 Ctrl+C 关闭隧道。** 不要通过关闭 Origin/CSRF 验证、暴露 8787 公网端口或修改密码门禁绕过。
5. Cloudflare 官方说明：Quick Tunnel 网址每次重启会变化、无在线保证、**不支持 SSE（Server-Sent Events）**。因此依赖 SSE 的 V6 实时功能可能受限，手机浏览器能打开并不表示所有动态功能已经通过验收。参照 https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ 。

## 三、在任何手机公网共享前的必须验收

- [ ] 本机运行的是精确 SHA 的完整 FAYO 后端，不是 Streamlit 独立页面。
- [ ] 原有账户/设备授权与后台持久数据有完整**离线备份及恢复预演**；新安装不能自动“继承”原账户。
- [ ] 无实盘券商连接、无自动交易、仅唯一受控后台实例；`QD_CLOUD=1`、回环监听和访问密码均生效。
- [ ] 从陌生浏览器和无授权设备访问必须被拒绝；个人邮箱验证码和 V6 登录都经过真实验证。
- [ ] 手机和电脑读取同一账户权限范围内的数据；源端过期报价不能因为网页刷新就标为实时。
- [ ] 断开隧道后手机 URL 失效；开机重启恢复前不能宣称 7×24 小时可用。
- [ ] 若需长期固定网址、SSE 与稳定访问，应另行设计有域名的受控正式隧道或其他方案，不能把临时预览承诺为永久生产。

## 四、当前交付状态与限制

此文档是可执行的操作流程，**不能代替在用户 Windows/手机上的实际部署**。仓库完整源码可以在 GitHub 保存；安装包只包含运行所需子集，原设备账户、审计和私有历史必须在原机器核对后迁移。工作流构建通过也不代表真实公网连接、行情授权、风控或多设备数据一致性通过。

与现有 `README.zh-CN.md`、仓库根 `ZERO_COST_HOST_DEPLOYMENT.md` 配合使用。原私网 Tailscale 方案仍保留作为可选路线，但本方案**手机不安装 Tailscale**。
