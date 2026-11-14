# 天枢智策 V6｜可复核交接报告（2026-11-15 第三轮增量核验）

> 本文是一份**当前可操作的接力入口**，并非“已全部开发完成”或“正式生产上线”的证明。
> **证据快照：**2026-11-15 约03:00（GMT+8）；GitHub `solviq87-cpu/v6-stock-system` / `dev`，核查时 HEAD：`582b8632b51c0b28bdbd5ba53cd26b7b4aab05d3`。
> **当前国内静态目标：**https://af3c7822e6aafc135.app.workbuddy.host/
> **规则：**后续以当轮远端精确 SHA、CI 回执和实际生产读回为准。本文不冻结未来代码，不自动授予数据源授权、模拟盘写入权或实盘交易能力。

## 0. 给下一位接手者的 60 秒摘要

- **唯一工程基线**是 GitHub `dev` 当轮 HEAD，不允许旧 ZIP 整包覆盖、裁剪功能或因压缩包体积差异推断代码丢失。先读根 `AGENTS.md`、`V6_BO/AGENTS.md`、`HANDOFF.md`、`V6_BO/integration/CHAT_HANDOFF.md`，并运行 `npm run context:resume`（仅限已拉取本地仓库）。
- **不能触碰的资产**：两张锁定主页 `V6_BO/public/index.html` / `V6_BO/public/mobile.html` 的字节、原四套策略、36个研究实验规则、选股卡、行情原时点15秒门禁、订单/模拟账本和用户历史、测试与恢复档案。若用户将来明确调整主页约束，应重新取证并修改锁定策略，不得擅自解除。
- **最后核查的 dev CI 是绿色，不等于生产。** `V6 CI` 的 12/12 GitHub 作业成功；`V6 Per-Commit Smoke` 成功。它们主要验证离线/合成/隔离行为，不证明真实资金、云端账户或交易所行情已获认证。
- **生产仍缺权威证据**：没有本轮持有效私密授权核对的线上 `/api/records` 读回、历史/余额/持仓的备份对账、完整 Node 后端的可访问生产实例、真实会话安全、实盘连续行情/来源许可、Windows/iOS 物理真机验收和第二环境灾备演练。静态 WorkBuddy 更新任务成功不能替代这些。
- **唯一静态发布者**为 `managed-task`，只负责现有 WorkBuddy 静态目标；后台预发布应为独立受控环境。禁止创建第二个对同一静态目标写入的发布者，禁止使用旧 WorkBuddy 站点当回退。
- **验收语言**统一为“代码存在 / 合成测试通过 / 隔离真实 HTTP 验证 / 生产带权限实测 / 业务持续验收”，状态升级必须附可重放证据，不以代码行数、CI 绿勾、策略数量或候选数据源数作为完成率。

## 1. 本次真实核验的证据链

| 核验对象 | 已查事实 | 不能因此推断 |
| --- | --- | --- |
| `dev` 源码 | [固定 SHA](https://github.com/solviq87-cpu/v6-stock-system/commit/582b8632b51c0b28bdbd5ba53cd26b7b4aab05d3)，2026-11-15 约02:49（GMT+8） | 后续 dev 不会再变、线上已运行同一 SHA |
| 完整 CI | [V6 CI 运行 #43628770118](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43628770118) 结论 success；实际展开为 **12 个作业全部 success** | 未接真实供应商也能通过的测试就证明持续实时、真实盈利或生产数据恢复 |
| 逐提交保护 | [Per-Commit Smoke #43628770168](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43628770168) success；同 SHA combined status success | 每个未来 PR 的所有历史提交都已获独立测试，仍需逐 PR 检查 Commit Coverage |
| 工程包工作流 | [Bundle #43629040860](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43629040860) success：**build=success，archive-in-repository=skipped** | 不能声称这轮完整 ZIP 已经自动归档到仓库；历史 ZIP 不等于最新 SHA |
| 静态自动更新 | [WorkBuddy Auto Update #43629040899](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43629040899) success；另有计划任务成功回执 | 不能声称原目标 HTML 哈希匹配、写入真实完成、Node 后端部署或历史账本已连通 |
| 发布归属 | [owner 配置](https://github.com/solviq87-cpu/v6-stock-system/blob/dev/V6_BO/config/repository-auto-update-owner.json)：`publisher=managed-task`、`scope=static-frontend-only` | 不能把静态发布者扩大解释为后台运行服务 |
| 历史需求基线 | [原始 50 项状态表](https://github.com/solviq87-cpu/v6-stock-system/blob/dev/V6_BO/docs/FULL_UPGRADE_STATUS_20261113.md) | 用户口头“48项”不能直接删除原始 2 项或重排原 ID |

以上是**本轮确实查询到的 GitHub 回执**。合并后的新提交需要重新查询自己的完整 SHA 与工作流；不允许沿用 `582b...` 的绿勾认证未来提交。此报告自身属于文档增量，须以其最终 PR 运行结果为准。

### 1.1 被 CI 实际执行的专项矩阵

| 改动类型 | GitHub V6 CI 的实际作业/检查 | 下一轮还须补的现场证据 |
| --- | --- | --- |
| 统一语法、全量回归、服务 | `verify`、`verify-web` | 部署环境启动、真实服务端全链路 |
| 数据来源、共用上游 | `multi-source-data-lineage` | 供应商上游身份、合法授权、连续记录、冲突样本 |
| A 股交易日、缺口、停牌 | `a-share-session-data-quality` | 交易所逐票停复牌和真实异常日期认证 |
| 云账本防丢与恢复 | `cloud-ledger-failclosed`、`cloud-records-backup-preflight` | 生产只读备份、真实恢复、跨机灾备 |
| 云账本 CAS/客户端 | `cloud-records-cas`、`cloud-records-cas-client`、`cloud-records-ledger-anchor-audit` | 真实两设备并发、独立保存可信锚点与崩溃恢复 |
| 登录、HTTP 与权限 | `cloud-records-http-auth`、`cloud-records-real-login` | 生产服务、撤权、会话失效、设备级权限 |
| WorkBuddy 审计 | `workbuddy-readonly-audit` | 持有效私密授权下只读真实静态内容与数据来源 |
| PR 历史与屏幕回归 | 对每个新 PR 另核 `V6 PR Commit Coverage`、`V6 UI Browser Geometry` 及精确 head SHA | 实体 iOS/Windows 验收与截图对照 |

**不把专项与全量重复相加成“总通过用例数”。** 12 表示 GitHub 工作**作业数**，不是 12 条业务功能已经上线。

## 2. 2026-11-15 已合并代码增量与边界

以下 PR 截至本次快照均已查询到已合并记录，描述的是**源码能力及回归**，不是生产开关已开启：

| PR / 主题 | 增量代码能力 | 必须保留的限制 |
| --- | --- | --- |
| [#265 A股开市日完整性](https://github.com/solviq87-cpu/v6-stock-system/pull/265) | 逐票检查两源同漏交易日；BaoStock `tradestatus=0` 保留为供应商声明停牌，区别真正有成交的日线 | 未获得交易所逐票停复牌认证；未补造零成交 K 线 |
| [#267 独立账本头锚审计](https://github.com/solviq87-cpu/v6-stock-system/pull/267) | 增加只读外部预期头修订/证明比较，发现有效旧前缀回退 | 预期锚点来源必须独立可信；不是生产灾备完成 |
| [#269 公司行为源行链接](https://github.com/solviq87-cpu/v6-stock-system/pull/269) | 供应商原字节、逐行来源标识、时点/结算种类只读匹配，保留失败证据 | 行哈希不是交易所签名，不能据此自动入账/交易；原 #268 未合并、留作审计 |
| [#270 云账户快照 fail-closed](https://github.com/solviq87-cpu/v6-stock-system/pull/270) | CAS 未决、失败、响应迟到或设备令牌轮换时，不再让陈旧账户快照显示为可信当前余额 | 仅独立客户端修复，真实云端账户仍需实测 |
| [#271 结算源行防重复](https://github.com/solviq87-cpu/v6-stock-system/pull/271) | 相同供应商行被不同事件重复认领时拒绝虚假独立权益；拒绝把分红报告当配股/退市清算证明 | `canApplySettlement=false`、`canTrade=false`，不是完整公司行为自动结算 |
| [#272 可选 CAS 运行时外部锚定](https://github.com/solviq87-cpu/v6-stock-system/pull/272) | 显式成对配置独立锚点时，在 CAS 读、写、回执上检测合法链的截短/分叉/残留 stage | **可选且默认不自动启用**；没有独立可信锚点与生产配置证明，不得说“生产防回滚已生效” |

前批已经合并的 P0 改动需一并保护：[云端缺账本只读和写后 GET #235](https://github.com/solviq87-cpu/v6-stock-system/pull/235)、[只读审计器与凭据门禁 #236](https://github.com/solviq87-cpu/v6-stock-system/pull/236)、[只读审计去重 #239](https://github.com/solviq87-cpu/v6-stock-system/pull/239)、[隔离后端真实登录用例 #242](https://github.com/solviq87-cpu/v6-stock-system/pull/242)。不得因后续旧报告仍写“待实现”就回退这些已存在的代码。

研究工作台最近已增加研究选择/导航、预测比较、证据档案和成绩单恢复能力，详见 [研究恢复与成绩单证据](RESEARCH_RECOVERY_INTEGRITY_20261115.md)；这些均不能独立证明历史真实收益。

## 3. 原始 50 项需求口径与八大模块

[2026-11-13 原始状态表](FULL_UPGRADE_STATUS_20261113.md) 的编号是 **50 项**（八大模块分别为 5 / 6 / 6 / 7 / 7 / 7 / 6 / 6），旧快照状态为“已完成 2、部分完成 47、阻塞 1”。该数量是**旧台账快照，不是今天重新跑过50条现场验收的统计**。下一轮逐项补证后重新标状态；禁止凭策略实现数量或测试数推算“完成了70%”。

| 模块及原 ID | 当前源码层面可确认的方向 | 整体交付判断 / 验收阻塞 |
| --- | --- | --- |
| 1 工程基线与合并（`1.1–1.5`） | GitHub 持续整合、有原字节锁定与历史回归 | **部分完成**；旧 ZIP 逐代历史对照、交付包与当前 SHA 一致性需核 |
| 2 数据底座（`2.1–2.6`） | 主/备用源、溯源、日历、15秒时效、金额单位及交易日缺口审计 | **部分完成**；真实许可、供应商原时点和交易所逐票状态未全面认证 |
| 3 策略（`3.1–3.6`） | 原四套策略保留；36 个独立版本的**研究实验规则**及条件、回测/解释 | **部分完成**；并非36个已认证可交易盈利策略 |
| 4 多因子与风险证据（`4.1–4.7`） | 环境因子、板块、正反证据、只读风险提示 | **部分完成，4.7 阻塞**；涨停/收益概率无成熟独立样本校准时保持 null |
| 5 专业回测（`5.1–5.7`） | T+1、滑点/成本、分窗、归因及绩效统计基础 | **部分完成**；公司行为可知时点、退市、真实基准与样本外认证仍缺 |
| 6 模拟盘与风控（`6.1–6.7`） | 账户/成交/撤单、幂等、CAS、账本安全与异常停单代码不断完善 | **部分完成**；真实数据恢复、双端冲突、持久运行及执行闭环未现场验收 |
| 7 PC/手机 UI（`7.1–7.6`） | 两张主页锁定，内页证据卡、股票/板块联动、K线与研究视图部分存在 | **部分完成**；原参考图 1:1、真机、双端同步及无障碍全链路需现场核 |
| 8 测试与交付（`8.1–8.6`） | GitHub CI、逐提交检查、文档与多批恢复记录 | **部分完成**；生产冒烟、可恢复完整包校验与真实运行交付证据需闭环 |

**计数处理：**保留全部 50 项原 ID，不将其“压缩成48条”。若以后需要48项展示视图，必须提供与50项原件的一对一映射和未遗漏证明，不能修改原件。

## 4. 数据来源：登记≠连接≠可用≠可交易

- 多源目录阶段的**120条是候选/已有接口路线**，不是120个独立已实测供应商。库中曾记录14源的生产许可白名单、共享上游识别，尚不能据此声称全部合法商业授权。参见 [多上游目录](MULTI_UPSTREAM_DATA_FOUNDATION_20261114.md) 及 [SEC/ECB研究扩容](OFFICIAL_SEC_ECB_SOURCE_EXPANSION_20261115.md)。
- 东财、腾讯、BaoStock、AKShare、efinance 等需要识别底层真正的上游与代理包装，**共同上游不能当独立交叉证明**。绝不能把来源数量直接当准确性评分。
- 2026年已登记 SSE/SZSE 研究交易日历共 **242个开市日**，证据首次观察时间是 2026-11-12；不能反填为2026年初就已知道，不能据此推断2027年或北交所交易日。见 [A股会话缺口审计](A_SHARE_SESSION_GAP_AUDIT_20261115.md)。
- 数据分层：① 原始供应商 HTTP 字节/行标识；② 归一化证券/单位/币种/复权；③ 供应商报价时间 `quoteAt` 与接收时间 `receivedAt`；④ 交易所/市场会话、停复牌/除权证据；⑤ 研究质量、交易用途。缺任何关键项要显式 `unknown`，不伪造0、不后补时间、不用日线或5分钟冒充1分钟实时。
- 真实报价**必须由逐票供应商原时点**通过15秒门禁及原报价用途允许后才能进入执行链；旧/未来/未知/只读价即使页面可展示，也不获得 `canTrade`。市值或观察用旧价必须醒目标出“非执行价”。
- 公司行为需要独立的公告原文、记录日/除权日/现金支付日/股份可卖日证据；`sourceRecordId` 或哈希只认证本地档案一致性，不认证交易所授权/经济条款。不得把离线来源链接报告直接记入真实账户。
- 新闻、板块资金、涨停概率、美股、外汇、K线等按来源、样本、时间与用途各自验收；未经独立样本外校准的概率保持 `null` 或明确“不可用”，不以视觉优化掩盖缺失。

## 5. P0 不可越过的生产阻塞

| 优先级 | 阻塞 / 不可做的事 | 解除条件（要有脱敏证据） |
| --- | --- | --- |
| P0-A | 权威云账户与历史**未证实恢复**；禁止清空账本、默认重建账户或用浏览器缓存覆盖云数据 | 持有效授权只读核对来源、记录数、版本/最新事件、哈希与备份；隔离环境恢复、双向逐项对账 |
| P0-B | 可选外部账本锚点不能假定已经配置且可信；禁止无锚时宣传“防合法链回退” | 独立安全保管可信原头与证明、部署成对配置、有效截短/分叉/重启/残留 stage 拒绝测试 |
| P0-C | 完整 Node 后端未获**该 WorkBuddy 目标**生产运行证明；静态任务不能代替后台 | 隔离预发布实例、HTTPS/认证、持久卷、健康/重启日志，之后生产带权限读回 |
| P0-D | 数据来源合法性、15秒实盘原时点和所有执行入口未现场认证 | 真实盘中连续取样、上游许可与预算、时区/交易日边界/整批断线重连、交易许可 fail-closed 证据 |
| P0-E | 服务端密码/设备/会话在目标真实部署中未验证；不得把隔离登录测试写成用户已能安全登录 | 真实 401/403、登录/登出、设备审批撤销、限流与 CSRF，泄露凭据轮换 |
| P0-F | 自动发布与工程包不能依据工作流名称判成功上线 | 静态源/构建/远端原字节哈希一致、唯一 owner、回滚快照；新完整包文件/大小/SHA/干净解包回归 |
| P1-G | 双端物理真机、同源状态与历史恢复未验收 | iOS/Windows 独立刷新、同账户一致、断网恢复/并发冲突、原图对照 |
| P1-H | 策略预报准确率、长期表现及真实短信/飞书未验收 | 冻结样本外统计与成本、概率校准；私密通知回执且不泄漏到公共通道 |

**停线原则：**出现账本损坏/回退、未知报价时间、供应商身份冲突、未经授权写入或测试门禁失败时，先冻结写入和交易/推送；保留只读诊断，不“自动修复”或“自动补零”。

## 6. 接下来分批执行，不重复造工程

| 顺序 | 代码与运营任务 | 必须提交的验收证据 |
| --- | --- | --- |
| ① | 对 `dev` 新 SHA、所有活动 PR 和唯一发布 owner 做精确清点；做当前完整树/历史差异归档 | 清单、全 SHA、文件/包指纹、未覆盖功能、精确 CI |
| ② | 云端账本**只读**权威来源与备份摸底；外部锚点信任链、CAS/幂等/两设备冲突专项 | 只读清单、锚点独立存储证据、拒绝断线/分叉/坏账本测试，不动用户数据 |
| ③ | 现有 `V6_BO/server.js` 独立预发布，验证登录、权限和数据模型 | 运行实例、健康/认证/重启/状态码、可恢复备份；与静态发布者分权 |
| ④ | 数据准确性：逐股日历缺口、停复牌、成交量/额与复权、独立上游、原始报价15秒门禁 | 原始字节摘要、源时间、每日对账、失败样本及只读回归，所有 CI 正常触发 |
| ⑤ | UI 证据卡与策略：逐股依据、风险/新闻/资金流与K线，真实样本外证明按成熟度放行 | 四视口浏览器 + Windows/iOS 真机、长时间监测、用户可核查证据、不合格不显示伪精确概率 |
| ⑥ | 冻结候选版本，完整包构建、灾备及灰度发布，最后才生产启用 | CI/原始页面哈希、干净解包测试、回滚演习、私有历史只读验证、唯一静态发布者的发布回执 |

代码变更必须落到**现有模块**，不得通过另起简化版演示站代替旧工程。新策略先隔离研究，不能直接改原四策略权重或放开实盘交易。实盘如需接券商，仅在明确授权与 miniQMT 真实风控验收后另行启用。

## 7. 每个 PR 必填“改动 → 测试 → 证据”三联表

| 字段 | 必填内容 |
| --- | --- |
| 需求与缺陷 | 唯一任务 ID、原始现象、可复现输入、风险级别 |
| 基线与修复 | base SHA、head SHA、变更文件、旧能力保留证明 |
| 负例/边界 | 旧值、未来值、缺失、跨日、断线、重复、竞争、损坏文件、权限失效（按功能） |
| 测试 | 真实运行的命令、环境、开始结束时间、退出码、通过/失败/跳过；报告路径 |
| CI | **本 PR 精确 head SHA** 所属 run URL、作业名及最终结果、Commit Coverage；不得借旧 PR 绿勾 |
| 验收层级 | 合成、隔离 HTTP、真实预发布、生产、真机分别明确通过/未测 |
| 风险与恢复 | 旧数据保留位置、精确回滚提交、运行时配置变更、不得删除的持久数据 |
| 源/许可 | 上游供应商的真正身份、公共/付费/授权、时点、用途限制、是否能交易 |

最少进行静态检查、受影响专项、原有完整回归、隔离 HTTP（后端改动）、四视口浏览器（UI改动）以及精确 head SHA GitHub CI。失败时**修复并重新提交触发实际测试**；不得取消必需检查、用空测试占位或仅修改绿色标识。

### 7.1 建议接手操作（不含任何口令或私有地址参数）

~~~bash
git fetch origin --prune
git checkout dev && git pull --ff-only
git rev-parse HEAD
npm run context:resume
npm run check

# 由实际具备 numpy / sklearn 的受控 Python 环境指定；不要填不存在的示例路径
V6_MODEL_PYTHON=/absolute/path/to/ml-python \
V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test

# 针对真实变更补独立专项，示例：
cd V6_BO
node --test tests/a-share-session-coverage.test.js tests/research-cross-source-history.test.js
~~~

执行前须对照目标仓库现行 `package.json` 与运行环境；命令列出**不代表本轮已在当前聊天环境执行**。不能用 GitHub CI 替代用户私有云环境的授权验证。

## 8. 发布、安全、数据恢复的操作边界

1. WorkBuddy 当前静态目标只允许已审核的 `managed-task` 更新；`V6_BO/config/repository-auto-update-owner.json` 是所有权声明。新的后端服务应在隔离目标上运行，不能伪造原域名具有 Node/Python 服务。任何静态发布必须通过 owner、CI、精确 SHA、Unicode 内容完整哈希和回滚快照。
2. **严禁在报告、PR、Git、CI、截图、浏览器导出放** `sharecode`、密码、短信码、会话 token、飞书 webhook、券商凭据或私人账本。只记脱敏相对路径、计数、哈希和审计事件号。密钥轮换不能通过删除文件行假装完成。
3. 跨设备账本更改必须由服务端单调 revision / CAS / 请求幂等保护，POST ACK 丢失先查询受权读回与只读回执；未知/冲突/非当前设备身份时一律 `blocked`，不能在客户端继续显示“已同步可写”。
4. 可信外部头锚须在**账本存储之外**单独安全保存；不能用同一个可被同时回滚的目录自证完整性。无可信锚时，即便内部哈希链完好也不能证明没有回退。
5. 发布/测试环境不得自动触达真实交易账户、付费接口或交易所不授权服务。仓库现有规范禁止在产品运行时引入 OpenAI/ChatGPT API 依赖；ChatGPT 接力是带外 GitHub 与文档协作。
6. 周末/休市：新闻公告可按授权刷新；保留最后交易日日期标签，旧报价禁止被视为今日实时，更不得生成下单意图或重复推送。
7. 恢复只在**新隔离目录**按精确 SHA、文件指纹、历史事件与余额/冻结/持仓对账后进行；代码回滚不删除真实账户、交易日志、来源原包或审批证据。

## 9. 可复制的单页交接状态（填写真实值，不准猜）

~~~yaml
handoffVersion: "2026-11-15-evidence-v3"
repository: "solviq87-cpu/v6-stock-system"
branch: "dev"
evidenceSnapshotCommit: "582b8632b51c0b28bdbd5ba53cd26b7b4aab05d3"
currentHeadAtNewHandoff: "重新获取40位SHA"
currentHeadCIRun: "重新核验run URL及全部作业"
lastCheckedCIRun: "https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43628770118"
staticTarget: "https://af3c7822e6aafc135.app.workbuddy.host"
staticPublisher: "managed-task"
staticScope: "static-frontend-only"
staticDeployedSha: "未核验"
staticRawArtifactSha256: "未核验"
backendProductionInstance: "未核验/无本轮可用证据"
backendProductionAuth: "未核验"
authoritativeCloudLedgerSource: "未核验"
ledgerBackupAndCrossMachineRestore: "未核验"
independentTrustedLedgerAnchor: "未核验"
productionCASAnchorEnforced: "未核验"
realtimeProviderAuthorization: "未核验"
continuousLiveDataAndOriginalTimestamp: "未核验"
iosWindowsPhysicalDeviceAcceptance: "未核验"
feishuPrivateDelivery: "未核验"
brokerRealTradingAuthorized: false
releaseBundleForCurrentSha: "未核验"
legacyRequirementsCount: 50
historicalTaskStatuses20261113: "2已完成/47部分/1阻塞; 非当前重验"
nextP0: "先只读权威数据与备份，再预发布鉴权/数据，再真实数据与完整验收"
rollbackRule: "revert本批代码；不覆盖/删除用户账户、行情档案和历史"
~~~

## 10. 查证入口与历史保留

- [根交接入口](https://github.com/solviq87-cpu/v6-stock-system/blob/dev/HANDOFF.md)、[工作日志](https://github.com/solviq87-cpu/v6-stock-system/blob/dev/WORK_LOG.md)、[历史 CHAT_HANDOFF](https://github.com/solviq87-cpu/v6-stock-system/blob/dev/V6_BO/integration/CHAT_HANDOFF.md)
- [50项状态表](FULL_UPGRADE_STATUS_20261113.md)、[36种实验规则执行边界](FULL_UPGRADE_EXECUTION_20261113.md)
- [交易日缺口](A_SHARE_SESSION_GAP_AUDIT_20261115.md)、[研究恢复](RESEARCH_RECOVERY_INTEGRITY_20261115.md)、[多上游溯源](MULTI_UPSTREAM_DATA_FOUNDATION_20261114.md)
- [发布原则](CHINA_WORKBUDDY_WRITE_TARGET.md)、[静态唯一发布者自动更新](AUTO_UPDATE_WORKBUDDY_20261113.md)
- 2026-11-14 资料库中的《天枢智策V6_交接报告_诊断与实施改进版_20261114.md》及相关修复清单属于**历史取证快照**。其中“本轮未改代码”“PR未合并”等描述仅对当时核查时刻成立；与较新 GitHub SHA/CI 冲突时以可重复的**新证据**为准，严禁删除原始报告冒充修复。

---

**交接结论：**当前代码已在“数据溯源—账本防呆—研究 UI—自动回归”上持续进化，但**全系统生产上线、真实云账户权威恢复、独立可信防回滚锚点配置、实时供应商认证、原样真机验收与可核验策略概率仍未达到闭环**。接手者的第一责任是保护既有资产与审计证据，补齐真实运行证明，而不是再做一个漂亮的空演示站。
