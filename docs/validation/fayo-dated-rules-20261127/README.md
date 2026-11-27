# F42.2 · 按历史日取用制度状态

以原总管 `dev@b936ebdddb8c11948dd0e63f95332898dd5c1cf5` 为基线，复用 `historical-session.js`、原逐日股票池和费用合同、原历史解释、完整实验工作线程及原研究页面。

## 决定及消费

已有历史快照能读取当日 ST、停牌和可交易状态，但没有传递当天的限幅及无涨跌幅限制标记。现共用 `historicalSecurityState`，供原历史选股快照、历史解释与撮合判断使用。浏览器研究副本与后端代码保持字节一致。

明确提供的当日限幅优先于股票默认值。显式缺失或无效的限幅在需要推导边界时返回未知并阻断。已有明确上下界仍按原合同处理。未提供该字段的旧研究输入使用原板块基线。无涨跌幅限制日返回“当前限价撮合模型不适用”，保留该日的原始标记。它需要另行验证适用的撮合模型。

这条修改进入 `/api/research/complete-run` 的原授权研究线程和“实验室 → 回测验证 → 历史实验”页面。隔离样本的股票默认状态为 ST、5% 及无涨跌幅限制，历史行明确记载非 ST、10% 及普通限幅。原历史解释现能使用该历史行生成对应形态规则证据。把最后一日限幅改为 null，或标记为无限幅时，该规则不命中。输出继续标注导入未认证、历史覆盖未知和 `canTrade=false`。

## 测试及实际使用

- 原提交专项加入四项回归，修前四项失败、修后 14 项通过。覆盖跨日字段、未来行变化、无效制度、无限幅和原解释消费。
- 原逐日股票池、公司行为、限价、成本口径及形态的相关兼容 54 项通过。
- 浏览器研究资源由原锁定构建器 esbuild 0.25.12 生成，两次构建摘要一致，原浏览器研究五份测试程序通过。构建、锁文件与产物摘要见 `web-build.json`。
- 原鉴权完整实验接口处理三个输入。原电脑和手机研究页面共六次执行，命中、未知及无限幅的规则结果一致。
- 当前 dev 的通用研究报告缺少公开复盘事实保护。该保护已由研究候选 #562 的 `74c03d8d8a6c8dd77b38edd56029422752ded5ee` 提供。本候选复用同一行检查，在组合中沿用已有实现。原生浏览器脚本加入了缺事实结果的回归，通用历史结果仍能展开。

后端、浏览器和未知分支有逐项回执，完整组合及远端工作流按最终提交另记。研究回放使用隔离输入及原研究合同。

## 复验及限制

在 `V6_BO` 目录运行。

```bash
node --test tests/phase4-execution-limit-integrity.test.js
FAYO_DATED_BROWSER=../docs/validation/fayo-dated-rules-20261127/browser.py node ../docs/validation/fayo-dated-rules-20261127/native.cjs
```

脚本输出目录默认是同目录，可用 `FAYO_STUDY_RECEIPTS` 指定已有目录。该目录须有三份输入 JSON。浏览器附加复验需要本机 Chromium 与 Python Playwright。

输入范围是 40 行带日期的合成历史，包含模拟价格、成交量及制度状态。实际交易日历、证券当年状态及供应商认证需要独立资料。该项只取得局部证据。历史全市场主数据、无价格限制的专用执行模型、正式制度断点的策略再验证和大陆实体设备仍待。代码回退沿原固定提交恢复，继续挂载现有账户、研究与证据卷。

## 同一候选续接 · 连板入口和战法消费

股票级 `noPriceLimit` / `ipoNoLimit` 在连板入口原有参数解构时被丢弃。修前的普通 10% 上涨样本会进入首板及一进二战法。同时，入口在逐日规则计算前按当前默认限幅提前拒绝，导致明确的历史普通制度被当前 null / 无效默认值阻挡。

现保留完整输入，按原 `atLockedLimit` 逐行核对实际边界，并使用共用历史状态读取最后一行的 ST 研究资格。原扫描及研究扫描额外保留 `eligible` 和 `reason`，下游可以区分未命中与当前模型不适用。窗口中存在未知或无限幅制度时，当前模型保守弃权；专用无限幅模型仍需研究和验证。原账户与独立风险保护继续分别核对，梯队研究不签发交易资格。

原七项连板兼容测试加四组用例，修前 8 / 11 通过，三组反例失败，一组已有阻断保持通过。随后增加一组历史 ST 与原扫描风险隔离对照。修后相关专项共 73 / 73 通过，静态检查通过。原工程完整回归 8038 / 8038，零失败、零跳过。原服务的 `/api/research/scan` 和 `/api/research/complete-run` 分别消费五个输入，首板命中顺序均为正常、否、否、正常、否。原研究页的电脑和手机视口完成十次操作，无页面异常，原查看者权限不能取得报告。

本续接没有新增模型、数据源、采集循环或运行依赖。共享浏览器模块和构建资源未变化，沿用已冻结构建证据；完整工程和工作流结果另按最终代码版本核对。`ladder-native.json` 的 `baseline` 是当时 Git 父提交，实际运行源文件摘要位于 `sourceFiles`，由最终交付清单逐一核对。

从 `V6_BO` 复验，输出目录须预先存在。

```bash
node --test --test-reporter=tap tests/legacy-ladder-consistency.test.js tests/limit-ladder-reference-price.test.js tests/phase4-execution-limit-integrity.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-ladder FAYO_DATED_BROWSER=../docs/validation/fayo-dated-rules-20261127/ladder-browser.py node ../docs/validation/fayo-dated-rules-20261127/ladder-native.cjs
```

五份输入由脚本从原合成历史生成。返回普通限幅的正例要求每个历史日都有明确覆盖信息。默认状态缺失或历史日缺口仍保留未知；不能从本专项推断实际发行初期、ST 变更或交易日历已经认证。恢复代码使用修改前 `0f5f24dfe86ec36e0163ccdc2b3f24966a36192a`，继续保留现有研究与账户卷。该项状态仍为局部证据，交总管统一集成。

## 同一候选续接 · F42.1 原逐日股票池资格消费

原历史账本已经核对 `universeObservation`，历史选股解释却没有读取该结果。明确排除、首次可知时间晚于历史评估截点，或股票池区间已有缺口时，原解释仍可能给出观察资格。

历史解释现在复用原 `validateUniverseHistory` 和 `universeObservation`，以原历史行的收盘 15:00 截点核对证券归属与主数据状态。每个证券保存 `pointInTimeUniverse`；不适用证券保留全部原规则和评分供复盘，但不进入观察池，`historicalModelPassed` 和聚合通过数同时受限。`universeExcluded` 独立计数，不混入行情缺失数。原观察优先级复用现有资格条件，无新评分体系。

六组新增反例修前全失败、修后原专项12项通过；加强正例确认原模型通过数由1变0，避免以原本未通过的样本验证排除效果。相关92项与静态检查通过。完整工程及当前提交工作流另按最终SHA核对。

原鉴权 `/api/research/complete-run` 及原电脑、手机历史实验页面使用五种合成输入。允许记录、明确排除、晚于截点1毫秒、区间缺口和没有股票池表的旧研究分别得到观察状态真、假、假、假、真；对应原模型通过数为1、0、0、0、1。规则证据保留。十次双端流程无页面异常，查看者不返回研究报告。

这里的资格是所提供的未认证历史股票池声明。没有表的旧研究保留 `declared=false`、`verified=false` 和原有研究行为，`canTrade=false`。证券类型、ETF误入、交易所身份、跨市场同码和完整真实主数据尚未在本批认证。F42.1只登记局部证据。不会把这次消费修复写成完整证券身份建设完成。

复验从 `V6_BO` 运行，先创建输出目录。

```bash
node --test --test-reporter=tap tests/research-explanation-projection.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-membership FAYO_DATED_BROWSER=../docs/validation/fayo-dated-rules-20261127/membership-browser.py node ../docs/validation/fayo-dated-rules-20261127/membership-native.cjs
```

输入由脚本从原合成历史生成。主数据的ST、停牌、退市与可用时间边界还通过直接调用原解释验证，真实发行主体和历史资料仍待。回退以本续接前 `bf02b02b7ba87c5948e3caff7924b5aa65f097e9` 恢复代码，保留原账户及研究卷。源回执 `baseline` 为当时Git父提交，`sourceFiles` 是实际运行代码摘要；最终组合和工作流独立绑定精确提交。

## 同一候选续接 · F42.1 证券类型原文线索

复用原本地新闻导入CLI、追加式证据档案、鉴权查询接口及双端“原文证据室”。在原 `event-research.mjs` 中增加有界文本投影，按同一行或明确的证券类型代码字段绑定代码，原页面消费该结果。不增加数据源、注册中心、行情请求、模型或运行依赖。

普通股行不会将类型传播到同表其他代码。明确的优先股/转债代码字段可以包含多个代码或代码续行。基金类型“股票型”不作为公司普通股依据；ETF需基金文档及唯一基金代码共同出现。重复冲突、多个基金代码、缺字段、畸形关联或仅有代码前缀时保留未知。旧版本、撤稿及被移除关联显示停用状态，按原归档截点回看。

七组新增能力用例在实现前不支持，既有四项通过；实现后补充并列字段和畸形输入边界，共13项通过。原新闻档案、鉴权、隐私与事件投影相关专项共31项通过，静态检查通过。源工程完整回归8053项通过，零失败、零跳过。完整工程和当前提交CI分别按最终版本记录。

真实公开文件节选已送入原CLI及原鉴权接口，并在电脑/手机原页面读取。年报表的600000得到普通股A股线索，表内360003/360008保持未知；另一份发行主体公告的明确优先股代码字段将360003/360008分别绑定为优先股，公告中的600000保持未知；基金概要中的510300得到ETF线索。没有通过证券简称或代码前缀猜类型。

三份文件来自实际公开PDF字节；字节指纹、实际收件、文字节选范围及归档可知时间分别保存。全部原始发布时间时分为未知，CLI导入并未伪造。归档前一个毫秒的原截点查不到新档案，查看者无法读取。此前补取的上交所公告HTTP200返回HTML，按不可用记录；后续使用独立公开的发行主体公告，未绕过验证页面。

本层始终 `sourceVerified=false`、`canQualify=false`、`canTrade=false`、`canTrain=false`、`canNotify=false`，用于研究阅读，不写证券主数据或股票池资格。交易所、板块、完整有效期及独立资料认证尚未完成。原文档可能是历史资料，不证明当前证券仍可交易。全部启用仍按原权限及总管集成。

从 `V6_BO` 复验，先建立输出目录。

```bash
node --test --test-reporter=tap tests/fayo-event-research.test.mjs tests/news-evidence-journal.test.js tests/news-evidence-http.test.js tests/news-evidence-ui-privacy.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-types FAYO_DATED_BROWSER=../docs/validation/fayo-dated-rules-20261127/type-browser.py node ../docs/validation/fayo-dated-rules-20261127/type-native.cjs
```

输入 `type-news-input.json` 为原始页内字样节选，`bodyScope=provider-summary`，页面显示“摘要或节选”。`type-source-receipts.json` 指向PDF摘要及来源；原PDF在独立验收包保存。源运行`baseline`是当时Git父提交，实际源码摘要位于回执。回退可用本续接前 `a4f4ed47048689ee02e47ecd40cafd26ec2ce80f` 恢复代码，保留原新闻、账户及研究数据卷。

最终复核去除新增正则后行断言，沿用原浏览器语法基线。同一普通股行出现多个代码而无明确逐列绑定时保留未知；新增反例修前失败，修后通过。此前8052项阶段回执保留，最终以8053项源全量、最终组合及当前提交CI分别核验。

## 同一候选续接 · F42.1 类型线索停用原因

在原事件投影中区分被后续版本替代、来源撤稿、本次查询关联移除、本页修订链不完整，以及未声明的待核对原因。多个原因同时保留，不把新修订的“本页缺少前版”显示成“旧版本”。完整返回范围补齐后可展示该页原文字样，所有资格和交易标记仍为false。停用状态下的类型冲突继续可见。

原页面直接消费原因标签，并将“当前事件”改为“最新归档版本”，避免把刚导入的历史资料误当最近发生的事件。原档案、哈希链、查询截点、分页、权限及原交易门禁不变，没有新增状态中心。

六组新回归修前失败，修后原事件专项19项及相关新闻/鉴权/隐私37项通过。源完整回归8059项通过，静态检查通过；最终组合及当前提交CI另行冻结。

原追加式档案构造57个同源修订版本，真实原接口分别返回最新50条和更早7条，在原页面点击“更早版本”验证链不完整与旧版被替代的区别。另外验证撤稿、关联移除、完整链、停用时的冲突，以及撤稿前历史截点。修订样本是明确标注的隔离合成数据，不是真实撤稿或政策事实。此前三份实际公开PDF节选再次经原CLI、鉴权接口及双端页面消费。三个屏宽共30次流程通过，未见页面异常或横向溢出。

首次浏览器脚本使用了错误的“下一页”按钮名而中止；实际控件为“更早版本”，脚本改正后完成全流程。失败日志与成功回执分别保存，不把中止操作算作通过。

```bash
# 从V6_BO运行，先创建输出目录
node --test --test-reporter=tap tests/fayo-event-research.test.mjs tests/news-evidence-journal.test.js tests/news-evidence-http.test.js tests/news-evidence-ui-privacy.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-states FAYO_DATED_BROWSER=../docs/validation/fayo-dated-rules-20261127/state-browser.py node ../docs/validation/fayo-dated-rules-20261127/state-native.cjs
```

源码摘要见`state-summary.json`，完整运行回执、原始响应及全部图片在独立验收包；复验脚本生成`state-native.json`。源运行Git父提交与实际工作树摘要分开，最终组合绑定精确提交。该增量仍为F42.1局部证据，正式身份、原始发布时间、完整主数据、大陆真机及总管签收未完成。回退代码可用本续接前`a578e2e4aad8e5fa57aa4c24b8aef3f88b3eb5da`，保留现有新闻、账户及研究数据卷。
