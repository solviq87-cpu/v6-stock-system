# Windows / WSL 本机安全更新操作

适用源码基线：`dev@e113e96e2fb9f5300b54809b9450427a745ca464`，需求来源 PR #277。实现位于 `V6_BO/deploy/windows-host/safe-updater.js`，与既有 WorkBuddy 静态发布器独立。**当前没有访问用户 Windows 或私有原账户，生产升级、手机访问及重启验收均未发生。**

## 绯曜原生入口兼容修复

原`cd3ad68`包的外层升级器仍将正式`/`与`/m`响应同历史物理主页比较，会拒绝新FAYO入口。修复后使用新原生主页比较，并核对manifest内全部原生模块（含懒加载）、PWA和公开模型目录的实际HTTP字节；旧版目录继续原校验。没有放宽CI、账户备份、权限或回退门禁。必须使用含修复的新外层控制器包；只更新运行目录内app不能修复旧控制器。

## 操作入口与默认行为

在包含本次控制器的新完整包中，先运行只读环境/调度审计，再检查候选：

```powershell
.\windows-host.ps1 -Action Audit
.\windows-host.ps1 -Action Update
.\windows-host.ps1 -Action UpdateStatus
.\windows-host.ps1 -Action PauseUpdates
.\windows-host.ps1 -Action ResumeUpdates
```

`Update` 对应 `check`，默认 dry-run：固定读取 GitHub `solviq87-cpu/v6-stock-system` 的 `dev`，核对安装 SHA 与候选 CI，不替换运行目录、不停止服务。用户可审阅后显式执行 `-Action ApplyUpdate`。WSL 的等价入口：

```sh
bash update.sh check
bash update.sh status
bash update.sh pause
bash update.sh resume
bash update.sh apply
```

非默认隔离安装使用 `--home /home/实际用户/独立目录`；PowerShell 为 `-InstallationHome`。路径应处于 Linux 私有主目录，不使用 `/mnt/c`、公开 Web 目录或符号链接。账户数据、密码、设备、备份和更新状态全部在仓库外。

控制器接受人工敏感变更批准 `apply --approve-sensitive <精确40位SHA>`（PowerShell `-ApproveSensitive`），只能批准相同候选的敏感范围；不会绕过 CI/来源/哈希/备份/启动检查。主文件 `server.js` 也拥有账本逻辑，故其中仅 UI 版本号变化也会保守触发敏感门槛。

完整包的外层 PowerShell/Node 控制器不在私有安装 `app` 中，应用升级不自动替换正在执行的外层控制器。涉及 updater 修复时需先停止 watcher，校验新精确 SHA 完整包后从新的受信控制器目录继续操作；不能只更新 app 后声称控制器也已升级。

## 必须通过的门禁

1. **唯一来源与精确候选**：固定仓库和 `dev`，要求已安装提交是候选的祖先，拒绝分叉、过大/截断的比较和不完整来源。相同 SHA 返回无需更新，网络失败保持旧服务。
2. **逐候选 CI**：核对该 SHA 的最新 push `V6 CI` 必要作业（含 verify / verify-web），适用的 UI 浏览器作业，以及 `v6/per-commit-smoke` 成功状态。任何未完成、缺失、失败、错 SHA 均阻断。切换前再次核对候选，避免检查 A / 安装 B。
3. **可信完整包**：通过固定 Git 远端取得精确提交，独立工作树构建完整运行包；核对 manifest、源文件、控制器、路径、大小、SHA256 和 sourceSha/controlsSourceSha。包不得包含用户私密配置或账户。来源依赖 GitHub HTTPS / Git 提交及受信仓库；**不宣称另有离线签名或对恶意仓库管理员的保护**。
4. **隔离验证**：先在合成 HOME/账户完成语法、全量测试、全新 replica 初始化、真实 HTTP 身份与重启检查，不复制用户真实账户到测试运行器。模型缺依赖保持实际跳过计数，未验证模型不算运行成功。
5. **互斥与冷备**：独立 updater 内核锁和运行控制锁；私有 transaction 记录阻止普通启动器在切换期间重入。确认受控唯一服务身份，优雅停止，冷备整个安装并逐文件哈希，再复制至独立恢复目录验证等价。外部未知写者仍须现场审计，不能通过一个锁宣称控制所有第三方程序。
6. **切换与回读**：保留旧可执行版本和完整私有数据，在独立目录叠加新清单内代码；原子重命名切换唯一根路径，烟雾启动后检查 HTTP 与真实首页/静态资产字节，私有非源码数据应与冷备一致。最后恢复原先的启动模式。

已有配置必须保持 replica、外发关闭、自动模拟成交关闭。不会自动提升为生产主写者，不能用新空账户覆盖旧账本。敏感账户迁移不是一条 Update 命令的替代品。

## 状态与失败恢复

更新状态保存在安装目录的同级 `<安装目录>.updater` 私有目录，含互斥锁、事务和去敏回执；其权限为 0700，文件为 0600。不要公开整个目录。`status` 提供暂停状态、事务及最近结果；回执区分候选 SHA、安装 SHA、CI 链接、包/清单哈希、备份/恢复预演、测试/跳过数和回滚结果。Windows、手机 HTTPS 和 productionDeployed 在未现场验证时保持 false。

- 没有更新、网络不可用、CI 不绿、包损坏和测试失败：禁止切换，旧服务及账户保留。
- 新程序启动失败且未发现新私有事务：停止新程序，切回旧**可执行版本**，重启原模式；保留失败目录和审计。
- 检测到新账本/私有事件、无法停新程序、恢复或回滚失败：进入 `recovery-required`，阻止后续新启动，保留两侧版本与私有证据，人工核对。现有进程无法确认已停止时，回执明确 `existingProcessVerifiedStopped=false`，不能据此声称旧进程已退出或全部写入已隔离。
- 断电/进程崩溃留下在途事务：不得删除 transaction、锁记录或重新 Initialize 来绕过。先查 `status` 和真实进程/目录状态，保存私有证据后由人工执行已核对的恢复路径。

当前没有针对任意断点的自动 resume/recovery 命令；新启动被阻断后需要人工逐项审阅 journal、备份和真实目录/进程，再决定可恢复路径。此限制保持 BLOCKED，不能当作断电后无人值守恢复已完成。

**不得用旧 backup 覆盖新版本已合法提交的事件。** 仅当证明无新事务且候选切换可回退时才回切旧版本；否则先隔离写入并进行事件级核对。回滚不通过即不得继续后续自动发布。

## 调度、暂停与异常通知

`pause` 持久保存停用状态，后续 check/apply 应拒绝新更新；它不杀当前业务服务，也不撤销已开始的事务。`resume` 仅允许未来检查，不自行安装计划任务。Status 与检查的退出码可由唯一调度器捕获，日志只记录去敏 code / SHA / CI，避免令牌和账户内容。

在 Windows / WSL 真实环境完成 Audit、升级、失败回滚、重启和私网验证之前，不启用无人值守应用更新。核对没有另一套 Windows 计划任务、systemd timer 或历史 updater 后，才能指定**唯一**定时任务，建议每 15 分钟检测并保留最近结果；避免多个调度系统同时启动。

已经提供显式 watcher：

```sh
# 默认：每 15 分钟仅检查
bash watch-updates.sh
# 完成现场门禁后显式选择自动应用；不保留敏感变更批准
bash watch-updates.sh --apply
```

PowerShell `-Action WatchUpdates` 只对应第一条 dry-run。独立 `watcher.lock` 防止同一安装重复轮询，更新本身还有 `update.lock`；每轮调用同一 updater，因此 pause/resume 持续生效。SIGINT/SIGTERM 不会中断子 updater 的备份/切换，等待它结束后退出；不要用强制终止来停用 watcher。此实现不是开机服务安装，尚未在真实 Windows 启用或验证重启。

当前环境未创建或启用用户计划任务，未配置消息渠道，因此“已定期自动更新”和“手机已收到失败通知”均未验证。WorkBuddy 既有唯一 managed-task 和其 owner/journal 保持不变，本机 updater 不发布静态站。

## 测试与真实安装回执

确定性覆盖范围及实际数量应以最终 PR / CI 的 `windows-host-safe-update`、`windows-host-network` 结果为准；入口运行示例：

```sh
cd V6_BO
node --test tests/windows-host-safe-update.test.js tests/windows-host-update-watcher.test.js tests/windows-host-network.test.js tests/windows-local-host.test.js tests/windows-host-stop.test.js tests/windows-host-process-inspection.test.js
```

网络配置 validator 新增 6 项、watcher 新增 6 项测试已通过，覆盖私网 HTTPS、嵌套/无效 Funnel、错误代理、额外路由、互斥、停用结果和等待在途事务；另以真实进程组 SIGINT 验证 Ctrl+C 不杀正在运行的独立 updater。既有宿主运行/停止/进程身份专项与最初 5 项网络测试共同 47/47 通过。Linux 只读 audit 已运行，系统与用户单元检查可用；这些结果不证明用户 Windows 环境。

真实安装回执目前为 **BLOCKED（未取得用户 Windows/WSL、原私有目录和手机 Tailnet 会话）**。现场需补：精确候选与安装 SHA、包 SHA256、CI URL、审计时间、唯一主写者、原账户冷备恢复预演、余额/持仓/委托/事件一致性、Windows HTTP、手机 HTTPS、关浏览器持续运行、Windows 重启、失败回滚及暂停后不升级。未经运行的步骤保持未完成。

### 本轮隔离验证结果

更新器专项32项、独立安全复核51项通过。独立复核还使用完整V6真实服务和精确源码包执行升级及注入失败回滚：校验30个电脑/手机HTTP资源，合成密码、账户数据及可变配置保留，原可执行版本恢复后健康。该次实测将CI发现/完整prepare依赖注入为合成门禁，测试快照不是实际生产候选，不能冒充真实GitHub CI。恢复预演仅为独立目录复制和逐文件哈希对照，未启动恢复后的真实用户账户。原始去敏回执保存在工作环境 `/workspace/artifacts/v6-20261115/review-live-update-result.json`，最终精确提交CI以PR为准。
