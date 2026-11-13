# GitHub 代码检测与 WorkBuddy 自动更新（2026-11-13）

当前唯一目标：`https://af3c7822e6aafc135.app.workbuddy.host`。用户在 2026-11-13 明确要求使用此新目标，并自动检测 GitHub 代码变化后更新。旧主机仅是历史记录，禁止用作失败回退目标。官方 API 与实际只读核验见 [目标说明](CHINA_WORKBUDDY_WRITE_TARGET.md)。

## 能力和当前状态

当前发布者选择为 `managed-task`：复用已绑定的唯一 hosted automation，每小时检查 GitHub `dev` 并在满足门禁时发布。该周期受任务条件 watch 限制；任务提示/标题更新既有任务，不创建第二个发布者。此方案使用当前 managed cloud 环境执行 `V6_BO/scripts/managed-repository-auto-update.js`，复用既有 CLI/coordinator，不要求先配置 GitHub Actions Secret。

仓库 `V6_BO/config/repository-auto-update-owner.json` 合约决定允许启动新轮次的发布者；owner 变更不能撤销已经开始的 POST 或 rollback，两个环境各自的 `flock` 也不构成跨环境互斥。managed 入口核验新轮次所有者属于 `managed-task`，否则不启动新发布；独立工作流 `.github/workflows/workbuddy-auto-update.yml`（`V6 WorkBuddy Auto Update`）保留 V6 CI 完成、每 15 分钟及手动触发的只读巡检，在 `managed-task` 所有权下不发布，日后配置 Secret 也不自动允许启动 GitHub 新发布轮次；切换仍必须执行下文停旧、清空在途事务再启新的步骤。GitHub 和 hosted 调度都可能延迟，不能承诺精确时限。

发布条件仍是 `dev` 精确当前头 SHA 对应的最新 push V6 CI 工作流及全部必要 job（包括 `verify` 和 `verify-web`）均成功。managed runtime 固定从通过 CI 的版本复制到仓库外，并用哈希 manifest 校验不可变执行文件；新发布执行时再核验 CI、精确 SHA 和 owner。已有受信事务的恢复按下文独立门禁处理。解决的是 GitHub Secret 配置依赖，不绕过 CI、所有权或内容门禁。GitHub 工作流保留独立 `actions/github-script` 只读门禁，核验候选 SHA、CI 和分支头后才 checkout 精确 SHA，且仅在所有权允许时加载发布凭据；真实 Actions 入口 `V6_BO/scripts/github-repository-auto-update.js` 还须绑定 gate SHA 和角色，避免仅由外层 YAML 判断。

发布后 `/api/site` 必须与预期完整源 SHA、`releaseId`、`artifactHash` 和实际 HTML 内容匹配，并通过 `/api/health`；相同源 SHA 但 HTML 不同也拒绝接受。标题或页面自带 SHA 标记不能单独证明已验证。失败停止，按原事务对账和已保存的加密快照恢复；未知当前内容哈希必须拒绝写入，不靠重新标记消除差异。私有 journal 和 AES-GCM 加密快照留存在仓库外运行目录；不能上传明文页面快照或分享码。

历史状态是“长期自动更新尚未激活”：当时 GitHub Actions Secret 公钥 API 返回 403，无法代配 `V6_WORKBUDDY_SHARECODE`，工作流缺 Secret 时跳过发布。当前改用 managed-task 的私有文件注入，不再将用户配置 GitHub Secret 作为这条路径的前提；该 403 权限边界仍然有效。**本次 managed 任务配置、真实发布及后续任务运行结果尚未在本文验证**，以本次 PR 的实际回执补充；只读健康检查、绿色 CI 或任务存在不能证明持续发布已成功。

首次真实大页面发布揭示 Unicode 传输损坏：线上完整 HTML 多出 21 个 U+FFFD，严格内容哈希校验拒绝成功回执。客户端已统一在拼接完响应 Buffer 后解码；损坏高度符合接收端或中间层按分块错误解码请求 UTF-8，具体服务端实现未证实。发布请求使用纯 ASCII JSON Unicode 转义规避该问题，JSON 解码后的 HTML 必须逐字节一致；本地真实 curl 分块接收回归覆盖中文、非 BMP 字符、反斜杠和控制字符。损坏标记页面须使用下文显式 legacy 恢复，再初始化通过 CI 的新版本，不能把声明的 SHA 当作内容证明。执行后的实际恢复/发布回执见对应修复 PR。

## 私有运行配置与唯一发布者切换

managed 运行目录、私有配置和凭据文件均置于仓库外。分享码以权限 `0600` 的文件保存，由私有配置 `shareCodeFile` 注入；运行配置绑定当前目标，固定 runtime 带哈希 manifest。值不得进入 Git、Issue、PR、工作流 YAML、命令参数、日志、截图或交接文档，禁止硬编码凭据。

已有 hosted 任务每小时调用固定 runtime 检查并发布。调度服务、当前 managed cloud 环境、私有文件及其权限/留存是运行依赖；不保证新建环境自动恢复旧运行文件、快照或凭据。缺文件、校验不符或权限不足必须停止发布并报告，不能自动下载未经核验的脚本或改用明文凭据继续运行。当前任务实际更新/执行结果由主线程在 PR 据实记录，不在这里提前声称成功。

角色切换必须由授权维护者按顺序完成：先停止旧 scheduler 并禁止其启动新轮次；等待所有在途任务结束，检查旧发布者私有 journal 的 `transaction=null`，未完成事务由旧 owner 先恢复；再合入 `V6_BO/config/repository-auto-update-owner.json` 的角色变更，等待该精确 SHA 的 CI 成功；最后才启动新 publisher。owner 配置本身不能原子排除跨环境双写，不能在旧 POST/rollback 仍执行时启新任务。当前 GitHub Secret 缺失且先前发布步骤 skipped，首次启用 managed-task 前仍须再次核实没有在途写入。

切换到 `github-actions` 还需仓库私有 Secret `V6_WORKBUDDY_SHARECODE`（[GitHub Actions Secrets](https://github.com/solviq87-cpu/v6-stock-system/settings/secrets/actions)）；反向切回 `managed-task` 同样执行停旧、事务清空、owner 精确 SHA CI 成功、再启新的过程。任何角色的入口发现 owner 不属于自己时，不启动新发布轮次；受信旧事务必须按冻结的 `publisherOwner` 归属处理，不能被新角色接管。

所有权、Secret 或任务设置本身都不足以初始化没有受信发布标记的页面。首次初始化仍需授权维护者审核当前页面完整 SHA-256，显式 `bootstrap --apply --expected-legacy-hash` 并完整读回；若当前是已知损坏页面，先走下文精确哈希绑定的 legacy 恢复。后续 `once` 或托管任务才能持续更新。用户已有目标和发布授权，无需重复索取分享码。

## 安全运行与恢复

参考配置为 `V6_BO/config/repository-auto-update.example.json`；复制到仓库外的私有配置后，核对 `repository`、`branch`、`targetOrigin`、`stateDir`、`intervalMs` 和 `sourcePath`（`V6_WEB/workbuddy/index.html`），必要时指定 `repositoryRoot`。CLI 格式为 `node scripts/repository-auto-update.js <check|once|watch|bootstrap> <私有config.json>`，先使用 `check` 查看仓库状态与候选 SHA；首次初始化通过后，再运行 `once <私有config.json> --apply`；`watch --apply` 用于已有常驻运行环境，当前静态托管站不能运行此 Node 进程。首次必须由授权维护者执行 `node scripts/repository-auto-update.js bootstrap <私有config.json> --apply --expected-legacy-hash <经过审核的64位SHA256>`，明确绑定当前无标记页面，避免覆盖其他版本；此步骤移除线上历史硬编码凭据并建立受信发布状态。运行前核对 CLI 帮助和新 `dev` 的成功 CI。发布前快照必须私有保存并以 AES-GCM 加密。managed 路径凭据通过仓库外 `0600` 文件及 `shareCodeFile` 注入；仅在所有权为 `github-actions` 时使用 Actions Secret 和缓存。`GITHUB_TOKEN` 可用于仓库只读核验。禁止复用旧 `_release_publish` 脚本，它会 bump 锁定主页版本并可能暂存无关脏代码覆盖当前站点。

加密快照保留上限为 32 份，优先保留当前版本、仍有效的前驱版本及首次 legacy 备份，其余已经验证的旧 HTML 可轮换；当前不能据此宣称已有任何真实发布或恢复验证。保留失败前源 SHA、已验证站点 SHA、加密快照与去敏私有记录；失败后查看门禁或回读错误，修复后重新跑通过 CI 的候选版本。回滚必须使用该目标自己发布前保存的快照，不能切换旧主机或用仓库 BO 锁定主页替换新站界面。若快照/缓存不可用或回读无法确认，则停止并保留失败状态，不猜测恢复成功。

普通版本更新将事务目标、前驱完整身份和 `publisherOwner` 冻结写入私有 journal。managed 入口先检查受信 journal：匹配自身 owner 的旧事务优先离线恢复，无需等待新 `dev` CI 成功；恢复 source 永远拒绝生成 new candidate，只允许核对与处理冻结事务。未知 owner 或没有 owner 的旧事务必须停发并交维护者处理。此恢复能力依赖原私有 journal、加密快照和凭据完整留存，不能据此宣称实际跨环境恢复已验证。首次 `bootstrap` 是单独的迁移操作：同进程内可恢复失败，但若进程在首次写入后被终止，不承诺自动完成 legacy 恢复。此时授权维护者可在核对当前实际 HTML 完整哈希和原加密快照后执行：

```sh
node scripts/repository-auto-update.js restore-legacy /private/config.json --apply --expected-current-hash CURRENT_HTML_SHA256 --legacy-snapshot-hash ORIGINAL_HTML_SHA256
```

这只恢复经该目标密钥认证的 legacy 快照；当前内容一旦变动就拒绝写入，不编造旧提交号，也不调用 GitHub 或股票账户接口。该命令不会自动执行。GitHub Actions 缓存仅在成功保存后才能跨 runner 提供恢复证据；平台发布与缓存没有跨服务原子事务。服务本身没有比较并交换接口，所以仍须保持唯一自动发布任务，避免与手动控制台同时发布。

## 静态站点边界

官方仅支持 `POST /api/publish` JSON `{html,title?,author?}` 的单文件静态 HTML，每个请求需带私有 `sharecode` 查询参数。当前站源码保存在 `V6_WEB/workbuddy/index.html`，导入时只移除硬编码分享码后备值，保留运行时从 URL 查询读取的机制，界面、四策略、模拟盘及风控代码不作改写；来源证据以该目录 provenance 文档为准。

该能力不能运行完整 V6 Node/Python 后端，不能因此宣称云端持久化账户、行情采集、真实交易、飞书唯一主实例或全天候更新已完成。真正持续自动发布还需唯一发布者所有权、成功 CI、固定 runtime/私有凭据可用、首次完整发布回读，以及后续可观察的 hosted 任务记录共同验证；切换 GitHub 发布者时另需 Actions Secret。`productionDeployed=false` 保持到真实发布证据确认之后。
