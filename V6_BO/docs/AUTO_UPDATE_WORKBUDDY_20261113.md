# GitHub 代码检测与 WorkBuddy 自动更新（2026-11-13）

当前唯一目标：`https://af3c7822e6aafc135.app.workbuddy.host`。用户在 2026-11-13 明确要求使用此新目标，并自动检测 GitHub 代码变化后更新。旧主机仅是历史记录，禁止用作失败回退目标。官方 API 与实际只读核验见 [目标说明](CHINA_WORKBUDDY_WRITE_TARGET.md)。

## 能力和当前状态

仓库自动化使用 `scripts/repository-auto-update.js`，提供 `check`、`once`、`watch`、`bootstrap` 模式；默认检查不写站点，写入必须显式 `--apply`。独立工作流 `.github/workflows/workbuddy-auto-update.yml`（`V6 WorkBuddy Auto Update`）在 V6 CI 的 `dev` push 完成后、每 15 分钟定时及手动触发时检查新版本。GitHub 定时任务可能延迟，不能承诺精确 15 分钟 SLA。普通 GitHub 推送本身不等于通过发布门禁。

发布条件是 `dev` 精确当前头 SHA 对应的最新 push V6 CI 工作流及其全部必要 job（包括 `verify` 和 `verify-web`）均成功。工作流先通过独立 `actions/github-script` 只读门禁核对候选 SHA、CI 和分支头，成功后才 checkout 精确 SHA，随后加载分享码 Secret；不能先执行未经检查的候选脚本。发布前再次核对分支头和 CI，使用同一 SHA 构建产物，单个并发发布任务避免互相覆盖。发布后 `/api/site` 必须与预期完整源 SHA、`releaseId`、`artifactHash` 和实际 HTML 内容匹配，并通过 `/api/health`；相同源 SHA 但 HTML 不同也拒绝接受。标题或页面自带 SHA 标记不能单独证明已验证。失败停止，以发布前的加密站点快照恢复并再次读回验证；私有发布记录和加密快照通过工作流缓存保留，不上传明文页面快照或分享码。

**长期自动更新尚未激活，首轮真实发布/回滚尚未验证。** 当前集成调用仓库 Actions Secret 公钥接口返回 403，无法在此会话中设置所需私有 Secret。只读站点、文档与健康检查成功，不能替代真实写入回执或工作流运行记录，也不能证明长期持续运行。

## 一次私有配置

仓库管理员打开 [GitHub Actions Secrets](https://github.com/solviq87-cpu/v6-stock-system/settings/secrets/actions)，新增仓库 Secret：

- 名称：`V6_WORKBUDDY_SHARECODE`。
- 值：用户已有的新目标分享码，只在 GitHub 私有输入框填写。

此值不得贴入 Issue、PR、工作流 YAML、命令参数、截图或聊天交接文件；不得用明文环境变量代替 Secret。现有授权已覆盖实现、检查和准备自动更新，不需要重新询问目标或分享码。Secret 配置、工作流合入默认 `dev` 分支及手动触发工作流，仍不足以初始化当前没有受信发布标记的线上页面。必须先由授权维护者在新 `dev` 的 CI 成功后，审核当前页面的完整 SHA-256，显式执行下文 `bootstrap --apply --expected-legacy-hash`，再核对首轮发布回执、完整预期内容读回与健康结果。完成这次初始化后，`once` 和定时工作流才可持续更新。当前尚未执行 bootstrap 或真实写入；工作流尚未进入默认分支、Secret 缺失或初始化未完成时，不可宣称定时更新已运行。

## 安全运行与恢复

参考配置为 `V6_BO/config/repository-auto-update.example.json`；复制到仓库外的私有配置后，核对 `repository`、`branch`、`targetOrigin`、`stateDir`、`intervalMs` 和 `sourcePath`（`V6_WEB/workbuddy/index.html`），必要时指定 `repositoryRoot`。CLI 格式为 `node scripts/repository-auto-update.js <check|once|watch|bootstrap> <私有config.json>`，先使用 `check` 查看仓库状态与候选 SHA；首次初始化通过后，再运行 `once <私有config.json> --apply`；`watch --apply` 用于已有常驻运行环境，当前静态托管站不能运行此 Node 进程。首次必须由授权维护者执行 `node scripts/repository-auto-update.js bootstrap <私有config.json> --apply --expected-legacy-hash <经过审核的64位SHA256>`，明确绑定当前无标记页面，避免覆盖其他版本；此步骤移除线上历史硬编码凭据并建立受信发布状态。当前尚未执行；运行前核对 CLI 帮助和新 `dev` 的成功 CI。发布前快照必须私有保存，并以 AES-GCM 加密后进入 Actions 缓存。凭据仅通过私有环境注入，`GITHUB_TOKEN` 可用于仓库只读核验。禁止复用旧 `_release_publish` 脚本，它会 bump 锁定主页版本并可能暂存无关脏代码。

加密快照保留上限为 32 份，优先保留当前版本、仍有效的前驱版本及首次 legacy 备份，其余已经验证的旧 HTML 可轮换；当前不能据此宣称已有任何真实发布或恢复验证。保留失败前源 SHA、已验证站点 SHA、加密快照与去敏私有记录；失败后查看门禁或回读错误，修复后重新跑通过 CI 的候选版本。回滚必须使用该目标自己发布前保存的快照，不能切换旧主机或用仓库 BO 锁定主页替换新站界面。若快照/缓存不可用或回读无法确认，则停止并保留失败状态，不猜测恢复成功。

普通版本更新将事务目标和前驱的完整身份写入私有 journal，重启后先对账该事务，恢复不依赖 GitHub 源仍然在线。首次 `bootstrap` 是单独的迁移操作：同进程内可恢复失败，但若进程在首次写入后被终止，不承诺自动完成 legacy 恢复。此时授权维护者可在核对当前实际 HTML 完整哈希和原加密快照后执行：

```sh
node scripts/repository-auto-update.js restore-legacy /private/config.json --apply --expected-current-hash CURRENT_HTML_SHA256 --legacy-snapshot-hash ORIGINAL_HTML_SHA256
```

这只恢复经该目标密钥认证的 legacy 快照；当前内容一旦变动就拒绝写入，不编造旧提交号，也不调用 GitHub 或股票账户接口。该命令不会自动执行。GitHub Actions 缓存仅在成功保存后才能跨 runner 提供恢复证据；平台发布与缓存没有跨服务原子事务。服务本身没有比较并交换接口，所以仍须保持唯一自动发布任务，避免与手动控制台同时发布。

## 静态站点边界

官方仅支持 `POST /api/publish` JSON `{html,title?,author?}` 的单文件静态 HTML，每个请求需带私有 `sharecode` 查询参数。当前站源码保存在 `V6_WEB/workbuddy/index.html`，导入时只移除硬编码分享码后备值，保留运行时从 URL 查询读取的机制，界面、四策略、模拟盘及风控代码不作改写；来源证据以该目录 provenance 文档为准。

该能力不能运行完整 V6 Node/Python 后端，不能因此宣称云端持久化账户、行情采集、真实交易、飞书唯一主实例或全天候更新已完成。真正持续自动发布还需默认分支工作流、私有 Secret、成功 CI、首次发布回读，以及后续可观察工作流记录共同验证。`productionDeployed=false` 保持到真实发布证据确认之后。
