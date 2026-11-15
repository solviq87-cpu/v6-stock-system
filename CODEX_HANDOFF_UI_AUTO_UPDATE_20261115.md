# 天枢智策 V6｜Codex 直接执行交接（2026-11-15）

**任务：完整 UI 重构 + Windows/WSL 安全自动更新上线 + 手机免费私网访问。**

- GitHub 仓库：https://github.com/solviq87-cpu/v6-stock-system
- 唯一基线：最新 **dev**；本次交接核验 SHA 为 e113e96e2fb9f5300b54809b9450427a745ca464。执行前必须重新读取真实 HEAD、PR 和 CI，不能把这个 SHA 当作永远最新。
- 用户的硬约束：**不购买云服务器，不开通付费试用，不采购付费行情/模型服务**；使用已安装的家用 Windows 电脑 + WSL2 Ubuntu 24.04 做 V6 后台。
- Codex 需直接实施、提交 PR、测试和交付报告；**禁止重建简化版、删除功能、覆盖用户原私密账户或只交演示截图**。
- 本文是可公开的技术交接，刻意不包含用户本机具体用户名、密码、密钥、私有备份文件名或远程授权码。涉及私有环境的操作只在用户明确授权的环境内执行。

## 1. 现状与准确口径：不要再宣称 UI 已全面重构

- **PR #232 已合并**：此前约 70.49 MB 的 BN 原完整工程包做过真实下载、校验与源码对照，保留了 590 份增补历史代码文件于 archive/bn-1083-source-20261114。历史归档不等于全部历史版本都要运行，绝对不能用旧源码覆盖较新的报价、账本与安全门禁。
- **PR #276 已合并**：精确 merge SHA e113e96；仅修改 V6_BO/public/assets/app.js 中 JS 创建的登录遮罩、original-reference-fidelity.css 的作用域配色，并增加 tests/ui-login-gate-redesign.test.js（4 个专项测试）。**它只改了登录层，不是完整首页或手机 UI 重构**。用户真实打开后仍觉得是旧版，反馈成立。
- 当前正式桌面源 V6_BO/public/index.html 保留旧「量化看盘平台」标题、旧 header、quick-nav、旧卡片；terminal-dashboard.js 另外插入深色科技风壳层，导致新旧并存，视觉与操作导航混乱。另有 reference-dashboard.html 作为参考页面，但不是可以替代完整正式首页的生产入口。
- 手机端 V6_BO/public/mobile.html 和通用 CSS/JS 已实现部分深蓝布局、七项底栏、股票/研究联动，但没有完成所有页面视觉/行为统一与实机验收。
- V6_BO/public/sw.js 的静态 JS/CSS 是 cache-first，APP_VER 曾固定为 20261109cv；更新后若文件 URL 版本不变，用户可能仍看到旧 CSS/JS。须查真实 service worker、HTTP 响应、缓存版本、computed style、加载顺序，不能只凭单测推断页面已更新。
- Windows 上源码 ~/v6-stock-system 已从 GitHub dev 更新过；但**本机 Git 仓库和运行时是两个分离位置**。旧实例 ~/.tian-shu-local 曾运行旧 SHA 693083e 的 smoke，随后按用户操作安全停止；另有独立测试安装 ~/.tian-shu-v276-test 已使用 e113e96 初始化，并在 smoke 模式通过 HTTP 健康检查。均不等于生产已上线、账户迁移完成或真实数据采集可用。
- 用户已按步骤将原本机安装目录做了私有 tar.gz 备份并通过 tar -tzf 可读测试；**没有进行完整恢复演练**。具体文件名只在用户本机私有存储中查找，不能提交 Git。
- WorkBuddy 静态目标：https://af3c7822e6aafc135.app.workbuddy.host。该站是**单文件静态 HTML 托管**，不能执行完整 V6 Node/Python 服务、后台定时调度或权威模拟盘账本。不得以站点返回 200 冒称 V6 云端完整上线。

**用户提出的新明确要求：** 全面重构正式 UI，做真实家用电脑服务器版本，让手机通过免费私人连接访问，并增加 GitHub 新代码自动检测、门禁验证、自动安全升级。用户不要付费云服务器；电脑关机时完整后台不可用，这个物理限制必须明确。

## 2. 必须阅读的现有约束与文件（开工前）

1. 根目录 AGENTS.md、README.md、HANDOFF.md、TASK_MASTER.md、WORK_LOG.md；V6_BO/AGENTS.md、README.md、integration/CHAT_HANDOFF.md 和 integration/DEPLOYMENT.md。
2. V6_BO/docs/ORIGINAL_UI_REFERENCE_ACCEPTANCE_20261109.md、HOMEPAGES_LOCKED_SINGLE_PICKS_20261109.md、UI_SUMMARY_CARDS_20261114.md、UI_LINKED_WORKFLOW_ADOPTION_20261114.md、CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md。
3. V6_BO/public/index.html、mobile.html、picks.html、research.html、reference-dashboard.html、assets/app.js、assets/app.css、assets/terminal-dashboard.js、assets/original-reference-fidelity.css、assets/v6-reference-dashboard.js、sw.js，以及已有 UI 自动化测试。
4. V6_BO/deploy/windows-host/README.zh-CN.md、START.cmd、windows-host.ps1、host-runtime.js、init.sh、start.sh、stop.sh、check.sh；V6_BO/scripts/build-windows-host-bundle.py。
5. V6_BO/docs/AUTO_UPDATE_WORKBUDDY_20261113.md、CHINA_WORKBUDDY_WRITE_TARGET.md、WEB_PREVIEW_DEPLOY.md；V6_BO/config/repository-auto-update-owner.json、相关更新代理和 GitHub Actions 工作流。

**旧版主页锁定合约冲突：** 文档和测试曾要求 index.html/mobile.html 原字节不变；但用户现在明确要求重构整个正式 UI。Codex 应先列出保留的业务/安全不变量，准备新的有依据视觉基线和对应回归测试；不能为通过 CI 直接删除锁定测试，也不能将旧版白色页保留为最终成果。

## 3. UI：必须真正统一，不是堆几张卡片

**正式品牌：天枢智策（V6 仅内部版本）**。深蓝黑背景、霓虹蓝细边框、分级发光卡片、红涨绿跌；设计简洁，不能牺牲阅读或性能。

| 页面 | 必须完成的用户可见效果和保留能力 |
| --- | --- |
| 登录 / 身份 | 同品牌深色完整登录界面；只读、开发者、设备授权/撤权、六位授权码、找回通道、失败提示、会话过期；不削弱服务端鉴权 |
| 电脑版主页 | 顶部统一导航、左侧功能分组、四大指数、市场情绪/环境、四套策略统计、风险和数据质量；精选榜与股票证据卡；右侧 K 线、资金、因子解释；旧管理工具归入系统设置但保持可访问 |
| 手机版 | 同源数据、同一功能定义，单列适配、横向可滑导航与底部七项：首页、自选股、行情、AI 研究、模拟交易、风控、推送。320–430 CSS 像素要可读，不能竖排中文、遮挡或横向溢出 |
| 选股 / 个股详情 | 点击同股联动、日/月/年 K 线、板块资金、新闻依据、策略命中及失效原因、原始报价时间/供应商/交易日/新鲜度，切股时旧请求不能覆盖新股 |
| 研究 / 模型资料库 | 策略证据、筛选批次、待复核持仓、任务状态、历史版本比较、样本外表现、数据和模型来源，缺失数据标未知而非 0 或成功 |
| 模拟盘 / 账户 / 风控 | 余额、仓位、委托、成交、冻结资金、恢复审计与风险操作一致；必须保留现有写入权限和账本门禁 |
| 新闻 / 行情 / 推送 | 证据时间与行情时间分离，周末股票行情冻结旧报价而新闻可独立更新；发送状态与手机实际送达不能混同 |
| 加载 / 异常 | 未登录、只读、缺数、断网、旧价、盘后、休市、无模型、设备被撤权、服务重启均需明确提示 |

**实现要求：** 首先建立正式页面/老控件 DOM ID/JS 引用/API/权限/数据来源矩阵；再选一个统一的真实 UI 外壳整合旧控件。不要简单 display:none 旧业务逻辑、删除脚本、复制一份漂亮静态演示或创建第二套互不连通的界面。必须把旧操作迁移到唯一可见入口，并保证其接口和状态机有效。

**视觉验收：** 电脑 1366/1536/1920 CSS px；手机 320/375/390/393/430 CSS px；真实 Edge、具备条件时 iPhone Safari/Android Chrome。未取得真机证据时标记阻塞，不得称 1:1 已完成。原参考图文件名为 7165.jpeg 和 E419BE1D-AB04-4D50-A482-8676AE7FB869(1).jpeg；若不在当前工作区，先报告缺失并索取授权，不能凭空声称逐像素还原。给出真实前后对比图、录屏、每张卡片点击结果和状态说明。

**缓存验收：** 更新 JS/CSS 后刷新应读取新版本；测试旧 service worker 持有缓存、无痕模式、离线回退、登录状态、切换角色、撤权、数据恢复。资源版本合约和测试需同步，不能默认用户按 Ctrl+Shift+R 才看见新版。

## 4. 免费部署：Windows + WSL2 做唯一后台，手机是客户端

- 使用用户已有的 Windows 11（以现场系统核实为准）与 WSL2 Ubuntu 24.04，Linux Node >=22.6（实测 v22.16.0）、Python 3、flock；不要重复下载安装已有工具。
- 后端只绑定本机 127.0.0.1:8787；设置本机开发者密码并验证 Windows 访问，再配置用户免费私人网络 Tailscale Personal / Serve 实现私有 HTTPS 手机访问。手机和电脑读取**同一个**服务端的账户/持仓/策略快照/历史，不能各启一个采集或推送主实例。
- 仅 Tailscale Serve、**禁止 Funnel**、不开放路由器端口、不绕过鉴权、不把服务不加限制绑定到 0.0.0.0。不硬编码 Tailnet 专属地址或把 WorkBuddy 分享码变成管理员令牌。
- 电脑睡眠/关机、WSL 停止、家庭网络断开时后台不可用；免费不是 24x7 云服务器保障。只有经过真实验证才能配置 Windows 计划任务 / systemd 和故障恢复。不能擅自变更 Windows 电源、代理、VPN、防火墙。
- 开发/测试模式保留 pushRole=replica、禁止重复外发推送、禁止自动模拟成交与真实券商下单。正式主写者唯一性与数据迁移须独立现场确认，不能用一份新空账户覆盖旧账本。

## 5. 核心新功能：GitHub 自动检测更新 → 安全验证 → 本机自动上线

现有 Windows 启动器只支持 Initialize / Smoke / Start / Status / Stop / Open，**没有无损自动更新**；它逐文件验证 manifest。直接 git pull 后覆盖 ~/.tian-shu-local/app 将触发 installed-code-changed，并可能破坏账户。

Codex 必须实现并验证独立、唯一、可审计的本机 updater（默认 dry-run）：

1. 定期读取 GitHub dev 最新精确 SHA，固定更新源和已安装 sourceSha；候选 SHA 未变化不执行发布；网络失败保留旧服务。
2. 确认候选 SHA 的 GitHub V6 CI 所需 verify、verify-web、可适用 UI 浏览器检查和逐提交 smoke 全部成功；阻止 CI A / 部署 B 的竞态。任何失败或未完成都禁止更新。
3. 从审核过的精确 SHA 构建可重复的完整运行包，验证来源清单、哈希、路径、签名/完整性与无私密文件；在新的受保护目录部署，不得直接覆写运行中安装。
4. 唯一 updater 进程锁与唯一业务写者核验；保存原版本与其私有状态，优雅停止后冷备整个用户运行环境（配置、密码/设备、账户、权威订单、审计、新闻/研究档案及必要缓存），做备份完整性和**恢复预演**，不得把私密文件写入公开 Git 或日志。
5. 在隔离 staging + 合成账户运行 check、专项/全量测试、实际 HTTP/权限、模拟盘一致性、登录与多端页面、重启持久化；涉及持仓账本/schema 的变更必须比普通 UI 更新增加人工批准门槛。
6. 门禁通过后才能原子切换**唯一**本机服务入口，验证健康检查、真实首页资源 SHA、登录身份、数据完整性、手机 HTTPS 读取和后台进程。后台应继续按既有 replica 安全状态运行，不能因为更新变成双主写者。
7. 失败时停止新版本并恢复旧**可执行版本**；若账本格式或新事务已生效而无法安全回滚数据，则 fail closed、隔离写入、人工处理，不准覆盖已经合法提交的新事件。
8. 记录去敏审计回执：发现时间、candidateSha、CI URL、源/包哈希、安装 SHA、更新时间、备份验证、回滚结果、测试数量、Windows/手机访问验证。未真实上线不得写成功。
9. 引入定期任务前先审计 Windows 计划任务和 WSL 服务，防止两个自动更新器或重复扫描/推送；不得擅自修改电源和防火墙。任务触发频率、异常通知、暂停/恢复、用户可查状态要提供简单入口。
10. 用确定性测试覆盖没有更新、CI 红灯、无网络、错误 SHA、坏包、备份失败、迁移失败、抢锁、重入、启动失败、回滚失败、Windows 重启与用户主动停用。通过后再让用户实机验收。

**项目硬约束：** 原四套策略、15 秒原报价时间门禁、A 股 T+1、防未来函数、模拟盘与风控、设备授权、公告/新闻分层、数据来源溯源都保留。无来源/旧报价/停牌/时间缺失必须显示未知并禁止冒充实时；旧日线或五分钟不能冒充盘口成交价。不得连接券商实盘或购买数据服务。

## 6. WorkBuddy 静态站自动发布是另一条链，不能代替上面的本机 updater

现有配置 V6_BO/config/repository-auto-update-owner.json 为：

- publisher = managed-task
- scope = static-frontend-only
- branch = dev
- targetOrigin = https://af3c7822e6aafc135.app.workbuddy.host

已有 managed-repository-auto-update.js / repository-auto-update.js、GitHub 只读巡检与每小时托管任务，**不得再创建第二个能写站点的发布者**。先核实实际运行回执、私有 shareCodeFile、owner、私有 journal 与加密快照；缺任何条件必须停发。现有权限不足时不得回退到旧主机或从聊天索取明文分享码并存入仓库。

静态发布需精确 dev SHA 和 CI 门禁、唯一 owner、发布前密文快照、实际 HTML 内容和 Unicode 正确性 SHA 校验、发布后 /api/site 及 /api/health 全量回读，失败按已有状态机恢复。历史曾出现 UTF-8 字符损坏，禁止放宽 hash 验证。跨发布者切换必须遵守 **停止旧任务 → 等在途结束且 journal.transaction=null → 旧事务恢复 → owner 改动的精确 SHA CI 成功 → 再启新发布者**。不要把 WorkBuddy 静态站 200 响应当作 V6 后端、持仓或 24 小时运行证明。

如果要从 WorkBuddy 前端接到家用电脑，只能在符合浏览器权限、HTTPS/CORS、私人 Tailnet 鉴权前提下设计；不能把本机私网变成公开未保护的 API，也不能简单换接口 URL 假装已经连通。

## 7. 开工、提交和交付门禁

**Stage 0：** 检查 dev HEAD、已有 PR/CI、全部入口页面与权限/状态流；确认哪些真正完成、哪些部分完成、哪些缺失，建立页面×业务×身份×数据质量×测试矩阵。对照用户当前实际截图/视频，不要只对比合成图片。

**Stage 1：** UI 结构和品牌彻底统一，迁移而非删除原功能。分别实现所有业务页面和手机端交互；处理缓存升级。提供真实 before/after 浏览器视觉证据和每个卡片的点击回归。

**Stage 2：** Windows/WSL 安全 updater 和状态机，先独立合成环境完成失败注入、模拟升级、回滚、数据不丢与无重复进程，再评估实际用户目录是否具备迁移条件。

**Stage 3：** 真正连接本机 Edge + 用户私网手机；验证只开手机/只开电脑、关浏览器后进程仍工作、Windows 重启和账户/持仓恢复；不能实测则如实标记 BLOCKED。

**Stage 4：** 按现有 GitHub CI 和 PR 合并规则逐提交发布，报告准确源码 SHA、通过/失败/跳过项目数、功能对比和尚未闭环项；**不能在只有 PR 合并、smoke 或静态 HTML 发布时写“完整生产上线”。**

执行检查示例（不要在真实账本上跑破坏性测试）：

~~~bash
cd ~/v6-stock-system
npm run check
V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
~~~

部分机器学习模型需要独立 Python 环境，缺依赖要说明 optional skip，不能拿绿灯冒充真实收益验证。

**必须交付：**
- UI_REDESIGN_ACCEPTANCE.md：所有页面/卡片功能矩阵、前后截图、320–1920 响应式检查、权限/缓存/数据真实性。
- ZERO_COST_HOST_DEPLOYMENT.md：Windows/WSL/手机免费私网操作、真实可达性、重启与家用机关闭限制。
- SAFE_AUTO_UPDATE_OPERATIONS.md：候选 SHA/CI/包校验、唯一写者锁、备份/迁移/回滚、调度开关、失败演练与真实安装回执。
- 最新 PR 和 GitHub CI 链接、SHA 与清晰的 DONE / PARTIAL / BLOCKED 状态表。

## 8. 可直接用作 Codex 开工任务的最后指令

**请从 https://github.com/solviq87-cpu/v6-stock-system 的最新 dev 分支读取本交接和所有约束，按 Stage 0–4 增量实施完整 UI 重构与 Windows+WSL 零付费自动上线系统，并在具备条件时验证免费手机私人访问。不要创建第二个 WorkBuddy 发布者，不要改买云服务器，不要删除原策略、权限或私有账户，不要将 PR #276 配色修复冒充全部 UI 完工。请直接进行真实代码修改、专项/全量测试、PR 和 CI；把每一项已完成和未完成/阻塞、实机截图、来源与部署回执明确报告。用户本机文件没有直接访问能力时不要编造已经迁移成功。**

---

**状态说明：本交接是执行要求，不是宣称所有工作已完成。Codex 若缺少该仓库或用户电脑访问权限，应报告真实阻塞并先完成可以在 GitHub 环境内执行的部分。**
