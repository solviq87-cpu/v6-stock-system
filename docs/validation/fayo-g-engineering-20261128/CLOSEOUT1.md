# G专项第一轮收口（G01/G02/G04/G05/G07；非发布）

冻结父提交 `5fc5270cc73ca618aba975e7f88ae39338973b8f`，dev `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`，F候选#612 `14ec08aa50d31660b0f4f46c29a95cc11ac1bc6f`。沿原#615增量，不新建PR、不改业务权威、UI或发布。当前任务仍按96原编号记录。

## 实际测试质量整改（G04.11/.12/.16）

原 `V6_BO/scripts/check-critical-mutations.js` 将stdout和stderr拼成同一TAP证据，未检查结束计划位置；混合断言失败和其他异常也可能误判变异被捕获。保留四项固定变异和原5项分类测试；新增4项，限制完整回执只能来自stdout、终止计划之后才允许摘要、拒绝Bail out和stderr伪回执、所有失败均须有原断言诊断。原变异注入定义、业务测试路径、超时及执行入口未改。正常Node真实断言与无关stderr仍可识别。

- 源文件原blob 6618812e525d9f71d00fce64ebd11c88696f82e1；原测试cf7d7086e2be5c7b5b01aac4be3d7eeef808a0e8。
- Node 22.16.0：node --check 两文件，node --test V6_BO/tests/critical-mutation-classification.test.js；原代码加新测试6/9，整改后9/9、零失败/跳过/取消；真实Node子进程正常对照已跑。最初子进程测试继承父测试上下文导致退出码0，修正夹具隔离环境后重新执行两侧，不计初次夹具故障为生产缺陷。
- 实测blob f31d074820120ffcc75f294e0598445a14dfbd97、72e7093cea0ceee3010fe943ace9f8f5d4c2c18e；远端逐blob对照。原四项真实业务变异及全量CI本次尚未重跑。

## G01/G02 实际重复与共享合同

本次扩大字节级核查至现役public/dist/vendor，排除archive、history、docs、tests、integration；>=120字节，JS/MJS/CJS/PY/TS/TSX/JSX/JSON/CSS/HTML。两完整树各13个相同blob组：6对策略源码、1对因子配置、6对静态资产。不是13个重复业务实现；构建分发与兼容镜像不得删除，UI静态资产不改。之前限定不含public/dist时的0组结论保留为不同范围。

| 同源文件 | #615父/候选与#612字节核对 |
|---|---|
| `V6_BO/src/strategy/a-share-patterns.js` / `V6_WEB/src/vendor/a-share-patterns.js` | 两侧均一致；G 240ac36e3153，F 240ac36e3153 |
| `V6_BO/src/strategy/historical-indicators.js` / `V6_WEB/src/vendor/historical-indicators.js` | 两侧均一致；G 3fad4e7bb659，F 3fad4e7bb659 |
| `V6_BO/src/strategy/historical-session.js` / `V6_WEB/src/vendor/historical-session.js` | 两侧均一致；G 69d8fb8cc968，F c139ea07b9ab |
| `V6_BO/src/strategy/kline-bar-validation.js` / `V6_WEB/src/vendor/kline-bar-validation.js` | 两侧均一致；G cd0b5301d0da，F cd0b5301d0da |
| `V6_BO/src/strategy/model-features.js` / `V6_WEB/src/vendor/model-features.js` | 两侧均一致；G e4a349a752eb，F e4a349a752eb |
| `V6_BO/src/strategy/model-selection-conditions.js` / `V6_WEB/src/vendor/model-selection-conditions.js` | 两侧均一致；G 9929bac8f675，F 9929bac8f675 |
| `V6_BO/strategies/extended-factor-pack.json` / `V6_BO/public/assets/v6-extended-factors.json` | 两侧均一致；G 993e5ca19c01，F 993e5ca19c01 |

原 `phase4-execution-limit-integrity.test.js` 已有historical-session精确镜像门禁；原reference-dashboard-factors校验15个因子字段。新增 `V6_BO/tests/engineering-source-mirrors.test.js` 对另5个纯策略源码及完整因子配置执行字节一致性检查，不另建运行引擎，不改变UI。真实Git树确认6/6待检对均同blob；本地临时合成镜像树运行真实新测试6/6、故意改动model-features镜像5/6、恢复6/6；该夹具仅证实门禁有效，不是完整源文件或策略业务回归。新文件实测blob a1511d85380d33d341cb65614c5976e8b5bb60c6；实际仓库Node执行待CI。全量测试原glob自动纳入。

### 两个真实业务合同差异（交总管，不误删/不静默同步）

1. `V6_BO/src/core/historical-universe.js` 314c8f2dcd31931736972e29199bdefcba3856a4 与 `V6_WEB/src/vendor/historical-universe.js` 87c7ad815d4bfc214a554c80738744114bf08881 不同。后台校验强类型证券ID、真实civil日期、securityMaster覆盖与availableAt，并按上市/退市/ST/停牌证据判定可选；旧浏览器校验尚无securityMaster这些字段及门禁。实际消费路径：后台historical-validation、model-experiment、portfolio-lab和position-ledger-backtest；浏览器analysis.mjs、strategy-research.mjs消费同名函数。不能把浏览器旧研究资格当后台正式资格。需要总管协调研究语义、对原PIT反例做双端对照，再用原esbuild构建及原dist一致性CI验证；不擅自同步较大核心文件。
2. `V6_BO/src/strategy/feed-quality.js` 4bae33953cafc02575ddd34275af8cee3f3026bc 与 `V6_WEB/src/vendor/feed-quality.js` a6974431a5d08cd42a3e076bba25fb8468357d1a 不同。后台requireReal拒绝嵌套模拟/导入/只读标签、未来报价及晚于原观察日的K线；旧浏览器相应函数较宽。相同a-share-patterns模块也分别依赖本地feed-quality，不能仅凭上层同blob证明完整行为相同。已查实际导入关系；尚未确认浏览器所有调用场景使用requireReal，不把源码差异夸大为生产交易漏洞。建议先确认消费者合同与输入场景，保留兼容并运行原回测和浏览器全套。

## G05/G06 外部依赖新增核查

纠正第二批精简依赖表的可能误读：V6_BO除了TypeScript开发依赖，还有已锁定的可选 `@tencent-ai/workbuddy-cloud-sdk` 0.1.4-dev.ca27990.202610161713（lock blob 24b191b0aa18fc9227bbac9f790273502eff7a7e）。`V6_BO/cloud.js` b8d593638d2cd54fe30d6b5814e65f6e8e25d323 实际延迟加载SDK，三个云备份配置字段缺失则拒绝建立连接并降级本地。若显式配置，pushlog insert/select/upsert 可能处理title/text/channel/note/extra；历史注释描述公开读策略，实际远端RLS与启用情况未核，不能宣布安全或已泄露。代码搜索仅发现该模块及旧诊断测试等命中，非完整动态调用证明。登记给第二组/总管核实实际启用、出站与访问授权；保留已有备份和发布机制，不删除SDK、不新增API、不触发云访问。第三方SDK的可选性不等于生产业务依赖云模型；包许可、漏洞及真实内容校验仍待。

## 精确集成、回退及进度

- 本批仅修改原变异分类工具、原测试、新增6个源码/配置镜像检查以及工程证据记录；不改业务模块、原权威账本、15秒、T+1、权限、发布、依赖锁。四项旧变异不改。
- #612当前有5个与G候选共同修改路径（见机器回执），先合并共同基线及F专业成果，再保留本组更严格审计、双方交接历史及唯一有界检查点；本批两个变异原blob在#612一致，新镜像测试无同名路径。两个业务差异先验证再统一，避免两组重复修改。回退仅撤本批工具/测试与对应文档，不覆盖任何原业务数据。
- G02.12、G07.11本次完成实际冲突登记及具体集成顺序；其余状态不因新增测试数而机械提升。现为36项专项完成、48项部分完成、12项待办（剩60项未完整验收）。G01.3/.4/.5、G02.1/.3/.5/.9、G04.11/.16、G05.6/.13/.14、G06.2/.9获得增量证据，不宣称全部验收。
- 父5fc5270当次读取逐提交冒烟与PR覆盖2/6成功，另4项尚运行；第二批74e7e16当次读取5/6成功，PR浏览器仍运行。当前候选未取得全量CI，真实离线安装、已知漏洞、所有消费者、语义去重、模型启停、服务端强制分支保护、现场及总管最终验收仍待。不能将局部测试或旧SHA CI冒充新提交验收。
