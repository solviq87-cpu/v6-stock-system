# 数据来源真实性与接口兼容补丁 · 2026-11-26

## 范围与当前判据

基线 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`，独立分支 `fix/fayo-source-truth-audit-20261126`。本补丁落实原任务 **06、18、20、22、23、29** 的来源、接口、时间与验收细则，不新增任务编号，也不宣称这些原任务整体完成。原负责人继续提供模块证据；新总管聊天「绯曜 FAYO｜总管与最终交付」负责最终总表、代码整合、合并及验收跟踪。

只修复已复现的来源统计错误、当前 AKShare 接口改名兼容及错误的来源身份引用；新增两项仅登记候选。没有真实行情 API 请求、账号创建、购买、凭据使用、外发通知或生产切换。新候选不会自动启动采集。四套策略、原账户与账本、权限、设备授权、唯一写者和原报价时间门禁保持。

## 1. 从登记到运行的证据分别记录

当前目录 **122 条 = 原 120 条全部保留 + TickFlow、AShareAPI 两条候选**。它们不是 122 个独立发布者，也不是 122 条已连接的行情。

| 登记类型 | 原 120 条 | 当前 122 条 | 本轮能证明的范围 |
| --- | ---: | ---: | --- |
| `candidate` | 97 | 99 | 目录未声明已实现的适配器；新增两项只有官方资料复核 |
| `operator-import` | 3 | 3 | 手工输入/导入合同，不是自动行情接口 |
| `authorized-gateway` | 2 | 2 | 既有通用标准化网关，不能冒充已连接 iFinD/Choice 原生服务 |
| 命名脚本或模块 | 18 | 18 | 找到具体代码及显式入口/报告读取者；不证明部署启用或联网成功 |

准入分类当前为：`permission-review` 41、`guarded-research` 2、`registered-only` 50、`credentials-required` 27、`client-required` 2。原受控研究仍只有 BaoStock 与东财历史路线；没有扩大采集准入。

| 目录声明 | 实际代码与接线证据 | 不得推出的结论 |
| --- | --- | --- |
| `public-quote-probe`，3 条 | `src/core/public-quote-probe.js`、`quote-dual-source-diagnostic.js`、`public-quote-endpoint-health.js`；对应显式 CLI、只读看板投影与多源核验 | 诊断模块存在不证明持续在线、原始时间可信或授权 |
| `optional-research-sources.py`，5 条 | 同名脚本；`optional-research-view.js`、`scripts/research-cross-source-history.js` 读取已保存报告 | BaoStock 原许可范围不向其他 SDK 扩散 |
| `six-photo-sources.py`，5 条目录路线 | 同名 Python 脚本、`six-photo-backups.js`、看板投影；`em.js` 的显示备用报价读取 | 日 K、分钟 K、净值不成为当前成交价；备用展示不得进入 `lastPx` 执行缓存 |
| 历史/官方宏观等 5 条 | `eastmoney-historical-feed.js`、`sec-companyfacts.js`、`worldbank-indicators.js`、`ecb-fx-daily.js` 各有显式 CLI；`itick-stock-quote.js` 仅沿凭据条件进入原多源核验 | 研究/宏观数据不等于股票实时报价；可选凭据参数不证明账号已配置 |
| 授权网关，2 条 | `parallel-market.js` 通用合同、显式 CLI 和报告读取 | 网关模板不是供应商授权或实装 SDK |

原 120 与当前 122 的逐条代码文件、文件哈希、调用文件、用途、上游和未知阶段，见[122条机器审查清单](validation/source-truth-20261126/routes.json)；[14个候选渠道官方资料](validation/source-truth-20261126/official-14-channels.md)保留具体引用和用途边界。原120个ID另用改前基线固定测试夹具防止删除。仓库中的登记表和以下离线命令能持续产生逐路线阶段清单；不把临时原始日志写入业务目录。

```bash
# 从仓库根或 V6_BO 均可运行；只读目录，不联网。
npm run data:sources:readiness --silent

# 仅对操作者此前保存的私有普通文件做离线核验。
npm run data:sources:readiness --silent -- /private/one-shot.json
```

## 2. 修复记录：未请求被算作已观察

**现象与复现：** 使用原 `inspectPublicQuoteEndpoints`，固定北京时间 `2026-11-10 12:00:00`；注入的网络函数调用次数为 **0**，三条结果均为 `not-requested`。改前 `observedExactRoutes=3`，原测试也错误地接受 3。

**原因：** 审计以报告中有同名行代替真实请求发生，休市时的占位行被算进观察量。

**最小修复：** `data-source-readiness-audit.js` 输出升级到 `schemaVersion=2`；复用既有 CLI，不添加采集器。

| 字段 | 定义 | 同一休市反例修复后 |
| --- | --- | ---: |
| `reportedExactRoutes` | 有该确切路线的报告行 | 3 |
| `attemptedExactRoutes` | 确有请求尝试，包含失败；排除 `not-requested` | 0 |
| `observedExactRoutes` | 兼容名称，严格等于尝试数 | 0 |
| `successfulQuoteObservations` | 报告有通过结构、价格与时点校验的单次报价，包括过期快照；未认证真实性 | 0 |
| `recentQuotesAtAudit` | 在审核时钟下仍满足原 15 秒和原时间窗口的报价；仍未认证 | 0 |

每条路线分别记录登记、报告、尝试、单次报价、持续可用、授权、生产启用。缺证据时持续可用、授权、生产启用均是 `unknown` / `null`。`licensedLiveSources=0` 与各 `*Verified=0` 表示当前证据未证明，不能解释为真实系统全部未授权或未启用。未知路线没有伪造 `lastObservedAt`；休市报告保留 `lastReportedAt`。

**验证：** 覆盖休市不请求、403/429/302、HTTP 200 无合法报价、一次合法报价、到期报价、15 秒边界、未来/矛盾时间、同上游 SDK 不继承结果，以及原 CLI 私有路径/符号链接/大小边界。未请求行携带 HTTP 成功码也会被拒绝。

**剩余：** 本工具不做持续采样，无法证明长期可用率、合法用途、真正交易日历或价格正确性。未来消费者需按 schema 2 处理可空字段；不能把 `!licensedForLive` 或没有报告当作“安全”。

## 3. 修复记录：AKShare 当前接口改名

仓库隔离可选依赖仍固定 `akshare==1.20.35`；本轮不擅自升级部署依赖。官方迁移说明指出旧接口名没有保留别名，当前资料展示东财日 K 为 `stock_zh_a_hist_em`、新浪分钟为 `stock_zh_a_hist_min_sina`。参见 [官方迁移说明](https://github.com/akfamily/akshare) 与 [官方接口参数](https://akshare.akfamily.xyz/data/stock/stock_quote.html)。

**复现：** 注入只提供当前名字的本地 SDK stub，旧 worker 两条路径均在调用前抛出 `AttributeError`。这是版本兼容反例，不是现网 SDK 调用或真实取数失败回执。

| 路线 | 优先调用 | 仅新名字不存在时兼容 | 保留请求口径 |
| --- | --- | --- | --- |
| `akshare.daily` | `stock_zh_a_hist_em` | `stock_zh_a_hist` | 六位代码、`period=daily`、原起止日、`adjust=''` |
| `akshare.minute.sina` | `stock_zh_a_hist_min_sina` | `stock_zh_a_minute` | 带市场代码、`period='5'`、`adjust=''` |
| `akshare.minute.em` | `stock_zh_a_hist_min_em` | 无新增回退 | 原起止时间、`period='5'`、`adjust=''` |

只在新属性不存在时选旧名。新接口网络异常、内部 `AttributeError`、返回数据错误或非函数属性，均不会触发旧名重试或改换上游。

原始报告记录真实 `interfaceUsed`、`sdkVersion`、请求周期与不复权请求。数据合同保留原字段与值，成交量单位、金额单位、复权验证、延迟、时间语义验证均保持未知；K 线时间不是当前报价时间，`originalQuoteAt=null`、`canTrade=false`。原数据银行只投影允许字段，拒绝伪造的已验证/可交易合同。

**历史兼容：** 目录记录当前名称与限定的 `legacyInterfaces`。旧报告可继续读取，`reportedInterface` 保留旧身份，缺失的实际调用名和版本仍为 `null`，不回填历史。源码不会改写输入报告。

**验证：** 新/旧 stub、两名并存、新接口异常、不合法属性、原始请求参数、缺少时间、旧报告读取、任意字段隐私与伪造合同均有功能测试；原 30 项六图目录、备用展示、账户缓存拦截和原时点测试继续通过。尚未安装新 SDK 做联网验收，不宣称接口长期成功。

## 4. 身份更正与两个候选

`sina.evidenceUrl` 原误指第三方 BaoStock 下载器，现指 [新浪官方入口](https://finance.sina.com.cn/)，仅证明身份入口。BaoStock 引用改为 [发布者 PyPI 包](https://pypi.org/project/baostock/)；原 `zxygithub/baostock` 研究记录保留并明确为第三方 SQLite 下载器，不再冒充官方 SDK。

| 候选 | 已读文档能支持的区分 | 未认证与本轮动作 |
| --- | --- | --- |
| [TickFlow](https://docs.tickflow.org/zh-Hans/quickstart) | 免注册服务器仅日及以上历史 K/标的信息，盘中不更新；[注册 Free](https://tickflow.org/pricing/) 是另一个需凭据服务，资料列 10 次/分、每次 5 标的 | 上游发布方、运营主体、授权、报价 `timestamp` 的原始语义、量单位和实际延迟未知；仅 `registered-only` / `candidate` |
| [AShareAPI](https://ashareapi.com/docs/endpoints/quote/) | 与 mpquant/Ashare 不同；免费报价约 5 分钟刷新，`date` 只有交易日；自动脚本匿名限额按 2 次/分；文档量单位为手，日 K 与分钟复权口径不同 | 不满足原 15 秒执行证据；`elapsed_ms` 为请求耗时，`stale_age_s` 是最近成功取数的年龄，均不能代替原始 quote 时间；授权、真实覆盖与运行仍未知，仅候选 |

两个新条目的 `upstreamGroup` 为 `multi:*` 未核实来源，不作为两个独立发布者投票。注册不产生账号、凭据、实时轮询或交易资格。AShareAPI 文档中的声明单位另存 `*Declared`；实际单位和验证字段仍为 `null`。价格与限额是本次文档快照，启用前须重新核实，不据此购买服务。

## 5. 其余官方资料复核的用途边界

| 名称 | 原有实现/目录如何复用 | 本轮仍不能认证 |
| --- | --- | --- |
| [东方财富](https://quote.eastmoney.com/) | 东财直连、AKShare、efinance、Choice 按原发布体系关联 | 公共网页/API 使用范围、精确原始时间、实际延迟与部署连接 |
| [腾讯财经](https://finance.qq.com/) | 腾讯直连与对应 SDK 共同归入 Tencent；保留原字段解释 | 免费 API 合同、统一额度及原始时间语义 |
| [新浪财经](https://finance.sina.com.cn/) | 直连、AKShare/Ashare/easyquotation 新浪路线去重 | 各市场实时/延时差异、上游合作方与自动使用范围 |
| [同花顺 iFinD](https://ftwc.51ifind.com/gwstatic/static/ds_web/quantapi-web/help-center/permission.html) | 原 `ifind` 凭据网关；公开复盘页面与 API 服务分开 | 免费账户资格和具体权限存在资料差异，不解除凭据要求 |
| [通达信](https://www.tdx.com.cn/) | mootdx/pytdx 等保留 TDX 根源；官方会员接口与兼容协议分开 | 无 Key 包装器不代表正式服务授权 |
| [BaoStock](https://pypi.org/project/baostock/) | 原受控历史研究与官方包身份 | 分钟更新时间、真实覆盖与现网服务稳定性 |
| [AKShare](https://github.com/akfamily/akshare) | 复用现有三条六图采集及另外登记路线，按真实上游去重 | MIT 软件许可不自动授予上游数据使用权；各接口单位/时间需逐一验 |
| [efinance](https://efinance.readthedocs.io/en/latest/api.html) | 东财包装；保留行情 ID、复权和各市场差异 | 实时表缺原始时间、单股仅时分秒缺日期时不得补本机日期 |
| [Ashare](https://github.com/mpquant/Ashare) | 新浪主路/腾讯备路是同一包装器内的路由，不是新独立源 | 回退口径、复权、最新 bar 与 quote 时间的区别 |
| [easyquotation](https://github.com/shidenggui/easyquotation) | 原固定 Sina 备用；保留 date/time、now/昨收、量/额各自字段 | 请求耗时宣传不是行情年龄；不同字段同名不可推断同单位 |
| [mootdx](https://github.com/mootdx/mootdx) | 原待审核 SDK，归 TDX；失效官网不作授权证据 | 原始 quote 时间、服务 SLA、用途与当前兼容性 |
| [pytdx](https://github.com/rainx/pytdx) | 原候选/协议读取路线，归 TDX | 开源许可不代替行情服务权限；无原始时间不补造 |

## 6. 验证记录与交付边界

[完整命令、源文件及日志哈希](validation/source-truth-20261126/verification.json)。冻结运行文件的本地环境为 Node `v24.22.3`、Python `3.12.14`，模型环境使用独立安装的仓库固定依赖。冻结文件哈希和完整日志保存在本轮私有审查输入，不是生产回执。

- 第一轮定向 47 项：readiness、lineage、新 AKShare 兼容、原六图银行；0 失败、0 跳过。
- 来源/时间门禁专项另 26 项：端点健康、发布时点、隐式重定向、同源去重、原目录权限；0 失败、0 跳过。
- `npm run check`、`git diff --check` 通过；Python 改动通过 AST 语法检查。
- `node V6_BO/tests/full-server-isolated-smoke.js` 通过；临时完整服务、电脑/手机入口及版本、实际鉴权拒绝/登录已检验；无私有源目录读写或出站请求。此项没有真实浏览器行情验收含义。
- 本分支冻结工作树的完整 `npm test`：**5009 项，5008 通过、0 失败、1 项跳过**；耗时约 288 秒，退出 0，原 TAP 完整性检查通过。唯一跳过为本机缺少 PowerShell 的真实包装器测试。使用 `V6_TEST_CONCURRENCY=2`、`OMP_NUM_THREADS=OPENBLAS_NUM_THREADS=MKL_NUM_THREADS=1`、`RUNNER_TEMP=/tmp`，`V6_MODEL_PYTHON` 指向上述隔离固定依赖环境。
- 全量结束后只新增原120个ID保留断言和审查文档，未改运行源代码；该新增断言另行实际运行，最终PR的全量CI单独登记，不能把5009写成修改后完整测试数。
- **精确 PR/SHA 与远端 CI：由本聊天提交可审查PR后核验，新总管负责最终合并验收。** 当前结果属于本分支冻结工作树，不能直接作为后来改动提交或生产版本的通过证明；定向项已经包含于全量分母，不重复累加。

生产程序/私有卷、真实数据启用时间、有效观察日、中断记录与 5/20/60 交易日复查均未取得认证。程序触发/统计正确性与提醒/策略效果分开验收。没有新增持续任务或第二个账户写者。

## 7. 部署、兼容与恢复

由新总管聊天「绯曜 FAYO｜总管与最终交付」统一整合、合并、冻结最终 SHA 并跟踪验收与发布条件。本补丁的离线审计默认不需配置；可选 Python 采集器继续使用原显式入口和依赖环境。部署前核实实际 SDK 版本，不以本地 stub 测试替代真实接口检查。

readiness 输出 schema 从 1 到 2，旧消费者须处理 `null` 和新增阶段语义。新程序可读旧六图报告；旧程序可能不接受新名称的六图报告。需要回切时保全新报告、原始数据及日志，先在副本验证读兼容；优先向前修复，不把新证据删掉或旧文件覆盖回去。原账本、成交、计划和权限无需迁移，不能因离线诊断恢复旧账户数据。

## 8. 交给新总管的补丁关系

本分支从上述 dev 基线独立修补原有模块，不包含其他组分支，也不替代研究、账户或四级风险补丁。本轮没有合并到 dev 或操作生产。本聊天提交独立PR与精确SHA，新总管接收并按实际远端检查协调合并。

| 共享位置 | 本补丁的最小差异 | 整合时需保留的其他成果 |
| --- | --- | --- |
| 根与 `V6_BO/package.json` | 增加 `data:sources:readiness` 入口 | 主风险/门禁补丁的 `npm check` 审计与其他组脚本；不要整文件覆盖 |
| `config/data-source-registry-2026.json` | 两个身份引用修正、两个仅登记候选；原 120 ID 保留 | 其他组原路线和字段；不得因新增候选改变原采集权限 |
| `config/six-photo-sources.json`、Python producer、`six-photo-backups.js` | 当前 API 名、限定旧名兼容、实际调用与未知合同 | 原 30 条六图身份、原备用显示和执行缓存拒绝规则；报告格式需一起整合 |
| `data-source-readiness-audit.js` 与测试 | schema 2、报告/尝试/报价分计 | 后续数据质量/契约工作消费同一阶段定义，不建立第二个采集或授权中心 |
| `HANDOFF.md`、`DEPLOYMENT.md` | 本补丁状态与恢复条件 | 新总管聚合后的当前检查点、其他分支的部署/备份/回执；逐段合并 |

当前可交付的是可审查代码、可复现隔离证据与登记/阶段清单。没有接通证据、授权未知、持续观察未开始或未成熟的路线继续留在总表分母中，不从 122 条目录或原 78 项任务中删除。

 
## 2026-11-26 · 原06/18/20/22/23/29/51/78：122条来源实际使用审计（第一批）

- 用户新增明确要求：所有接口既要核查适配器、调用与业务接线，也要核查原始时点、合法授权、实际运行、下游消费和失败回退。不以登记数量、成功返回、单次探测或代码路径存在当作已实际使用。沿用原78项与原来源目录，不新增任务编号、开发锁、调度器或第二套数据源系统。
- 基线 dev f8aa7cab21174721e9e79622cb46d0746581a037、#376 f5521f7842f0a4c97f0d28b46b2620ef721d357c。对原122路线审查 JSON 和当前 registry 逐ID、适配器名称核对一致；原审查中的实现/入口/读取者路径均存在于当前 dev 递归树。18条命名适配器、2条通用授权网关、3条人工导入、99条候选，仅为声明/静态盘点。已读主链 em.js 的 fetchAllStocks、fetchBatchSnapshot、fetchKline、fetchSectorFlow/fetchGlobal、备用 six-photo-backups 与 server.js 原 tick/rebuildPool/ingestPx/运行观察、背景档案读接口。路径存在不等于精确适配器曾被调用，宏观/历史/公告/只读备用不能冒充可交易实时行情。
- 在原 data:sources:readiness CLI 补充每路线声明分类和实际运行样本状态，可选只读模式：npm run data:sources:readiness --silent -- --runtime-root /private/runtime-acceptance （可再附原私有单次行情健康快照）。复用原运行报告/哈希链读取器，仅取每日末次合格样本（最多10只股票）；同日混版本、隔离记录、未来/旧价/冲突、错误路径及损坏记录不产生正向证明。确切来源标签只证明局部原运行报价样本，不证明包装调用、完整覆盖、授权、策略/账户/通知实际消费。未出现的路线保持未知，不输出私有价格、代码、目录或未知来源标签，不创建运行日志。
- 已核对本地恢复的目标及核心依赖 blob 与精确父树。Node v22.16.0，来源原回归及新6项：31/31通过、0失败0跳过，TAP SHA256 29db4e462e3e8fa1b1ac2a24d783211ea2698ffba7c1cf03b0fb257729b55ffd。前两轮本地缺根package/原120 ID夹具的失败已补回原字节，未删除断言。
- Q一致性修复：复用原目录身份，拒绝缺失/未登记/错配身份、重复来源和重复上游、非布尔支持状态、无效或后于审核时点的核验；未知不计分，原门禁/权重不变。新增2项修前6/8、修后含原相关回归35/35通过，TAP SHA256 0212b5b3e2282c74668ac250a7fe55ac839bdc5404ee745addb6077278fcfef6 / 1766ab448081991d288ad1532a8381575144e68a84ccdc601cf54a87dc486c53。六个目标源码/测试语法检查通过。
- #376 前一精确head两套真实浏览器失败为原深度研究脚本在旧折叠位置读到0/78。修正定位到现有78项任务明细，保留78行、原首行、长观察、权限及不写账户等断言，新增四种筛选的真实浏览器操作断言。新脚本本地仅语法通过，必须由新精确head远端浏览器复验。保留原失败回执。
- 下一批按122条原目录逐路线核实实际接口/来源ID→采集/档案→质量→业务消费者→实际消费回执及适用性。优先行情、K线、资金、板块、新闻、财报、全球市场；能合规使用且有实际价值的路线接现有消费者，验证后才启用；不可用或欠授权路线记录阻塞，不冒充成功，不购买、不高频探测、不扩大执行权限、不清除历史。当前没有生产私有运行卷或真实网络回执，不能统计真实已用接口数量，全部下游使用验收仍未完成。未部署、未合并dev。
