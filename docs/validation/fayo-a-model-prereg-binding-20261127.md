# A40 模型候选预注册、缓存复用及原任务验收对账

日期：2026-11-27；原第四批 A 组 04.5、04.6 的后续整改，不另增原任务数。
固定父候选 A39：9d8ee46dd89df6db0c0f5059a925eb1bf766a3b3。

## 代码与回归
- 原 preregistration 模块绑定候选来源、因子定义、原始权重、实际候选权重及冻结日期，并在使用前复核模型身份、代码指纹、研究权限与未认证假设；不改正式权重或交易权限。
- 原 local-model-learning-proposer 输出同一候选绑定；原 worker 在异步生成后重检配置、时点、研究血缘和冻结特征；无变化缓存与原冻结日期、基准、模型摘要绑定。
- 原历史档案保留，不自动改写。失效的当前预注册不得绕过原门禁；归档历史与当前可执行预注册分开。
- 生产提交 42a8c80dc1bbf1f159b65e10ad2199121ccd8d87、73e46a2b25a341cf58d307d16881a1895a9f064e、33adc8c5180961120e84fbba21270754159e2925；生产 blob 分别 bff39b5d20261c2fe82f9c85e5756f98d563a751、79141ce63999f5051c400d08c8e655242d0134be、37f727e8354692c4f00246f52661adc6f9e3f65b。
- 新增核心测试提交 78cc64e6b1cc882f6f4c1f0a1a47f7890712e9f1，blob b9591b8f7cac4ed624561c86852215af83642ac6。Node.js v22.16.0，修前1/12，候选12/12；A38/A39及原相关回归联合61/61，0失败0跳过。本轮重新执行仍61/61。使用真实 SHA256 与本机模拟 HTTP；本地未完整克隆仓库，部分算法指纹依赖文件是测试占位，完整 worker 未原生运行。两项核心生产源码和新测试的本地 Git blob 与远端一致。
- 本轮从精确远端 worker blob 提取 registerCandidateLocked、latestCandidateRegistration、registrationFeatures，加载实际 prereg/proposer 源码，在 V8 隔离执行七种情形：正常候选/重复注册、无变化缓存、配置变化、父血缘变化、冻结特征变化、矛盾缓存权限、旧归档兼容。首轮6/7，最后一项因摘要替代器文件名前缀碰撞；修正替代器后7/7。此验证使用内存文件系统、模拟模型/归档依赖及非密码学摘要替代，不冒充原生完整链路。
- 原 factor-shadow-evolution.test.js 增加实际 worker 推理中配置及冻结特征变化的拒绝和锁释放断言，原正常模型响应夹具改用已声明的参考候选值而非任意1%变化；新增绑定回执断言。提交 bb8e16792dca47d07cd2423ff04cde2d169106db，blob 7da9648d4c9787240c6f6b72cddac4bfb6925049，语法编译通过；原生完整测试待 CI，不计入61或7。
- 本地日志 SHA256：修前 7a51beb31afaafa6162d7f8230371665b5b662742282a56ba78b4e5ff2e23e1c；修后 bac61e855c116764bcd743f4669f1a1b5be692db03b93a8004a7f254a241d3ac；联合 fa8aa2417c92dc114f390eb250f53f2abe2a8e93a47ef89a83a862cab4e9ac3d；本轮重跑 ce1804a0d05e31dcafd008c49384db11d366c93ce50c359d5e891270cb2c33b3。

## 原第四批 30 项进度口径
按 #405/#406/#408–#426 逐个原编号对账，#426 已明确全部30项有专项修复、0项最终验收。以下状态均为部分修复，不以新增测试数代替原任务数。
- 01.1/01.2 #405；01.3 #406/#408；01.4 #410/#411；01.5 #411；01.6 #423。
- 02.1 #424；02.2/02.3/02.4 #413；02.5 #412；02.6 #406/#408/#409。
- 03.1 #413；03.2 #409/#412；03.3 #414；03.4 #425；03.5 #413/#414；03.6 #426。
- 04.1/04.2 #415；04.3/04.4 #416；04.5/04.6 #417，A35–A40 属后续深化。
- 05.1 #418；05.2/05.3 #419；05.4 #420；05.5 #421；05.6 #422。
- 对账合计：完整验收0/30、部分修复30/30、未开始整改0/30。实际组合验收和现场证据仍待，不能标100%最终完成。

## 已定位的总管组合红叉（独立于A40）
读取 #427 精确 head 6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f，GitHub Actions V6 CI run 45930805277 / verify job 140282724697：6553测试，6546通过、7失败。六项失败在 paper-conditional-http.test.js（共享 prepare 第73行），一项在 paper-decision-plan-http.test.js 第57行。实际服务返回 qualifiedCount=0，原因是合成报价10.4、止损10.09、目标11的毛收益风险比约1.774，小于原2倍纪律，最大满足2倍的入场价约10.3767。浏览器 run 45930805271 / visual-geometry job 140282724049 也记录同一拒绝原因；提交覆盖 run 45930805294 失败。
总管及B组应检查正例合成报价/计划证据是否符合原门槛，并另保留追高拒绝反例；不得为测试变绿降低风险门槛或删除测试。此处仅日志定位，未修改总管/B组文件，未证明夹具修复后的全量成功。
注意 #417 与A40共用预注册文件，组合时必须保留双方原有因子包权重门禁、模型指纹和回执绑定；不得直接以 A40 旧基线覆盖 #427 组合源码。

## 未关闭
完整 worker、真实 Ollama、真实行情、A30–A40全部组合、全仓 CI、原30项逐项端到端和实地运行均未验收。当前只提交A组候选，未合并、未部署、未交易。


## 04.5/04.6 原任务组合补缺（后续）
对账原 #417 与 A40 候选：#417 已在预注册封存及复核时检查真实因子包的绝对权重边界；此前 A40 从另一固定基线出发，只在封存时依赖输入定义检查绝对边界，重读时主要检查单步变动，存在组合丢失原保护的风险。
- 在原预注册模块合并两边门禁：依据原因子包复核绝对权重，封存独立基础定义和权重对象，验证时同时检查原50%–150%绝对范围、单轮±8%以及A40模型输出权重绑定。模型来源与因子定义摘要不得单独移除。旧无基础定义的当前因子包记录仍按真实配置复核。
- 保留 #417 的全部7项新增回归，额外新增4项组合用例；与原普通预注册和窗口测试合计21项。
- 使用精确远端生产源码、原因子包和测试源码，在 V8 隔离执行同一套21项测试：A40前一版15通过6失败，组合补丁21通过0失败。哈希、文件系统及Node断言为确定性适配器，未运行原生Node完整测试、真实模型HTTP、完整worker或全仓CI。本次不能计为原30项最终验收。
- 源码提交 19ba310bff1103d88b0f1581994a3732d1168739，blob e3267f5e81162c84d4521acba37303d03b69b4d7；测试提交 7853e6cf266e2347b538038e729123b9f867aff1，blob ff62925f5b397d1245f39590992fc4239a1ef417。远端文件blob已核对。
- 更新同一 #545 候选，不直接修改总管 #427、原 #417、B/C/D组或正式策略权重。仍需总管在最终组合中保留本次双重门禁，运行完整原生CI；研究算法指纹已变化，旧活动预注册继续受原版本门禁限制，未重写历史记录。未合并、未部署。


## 04.5/04.6 等待与样本外读取门禁补缺
- 普通、模型、固定种子预注册共用实际档案身份、原权重边界、完整冻结前缀/时点、来源绑定及研究权限校验。等待验证独立返回 candidate-waiting-verified，不冒充已通过未来保留集验证；正式验证仍要求非空未来样本。
- Worker 持有已有候选时，普通和严格模式均须执行等待校验；不足原5个新增成熟研究日时，不读取 H5 收益文件；保留原冷却监控分支及无预注册的旧研究兼容模式。五日只是进入下一层核验的必要条件，非盈利或样本独立性认证。
- 复用21项原核心回归，新增5项等待契约测试，同一轮 V8 隔离通过26/26。使用实际远端预注册源码、真实因子包配置，以及确定性摘要、文件读取和断言适配器。
- 提取实际旧/新 Worker pendingRegistrationStatus 函数对照5项：旧1/5，新5/5，4项异常分别为越界权重、权限矛盾、前缀较早记录时间晚于登记时刻、孤立自动来源。另提取实际 evaluateOnce 与等待函数，用 H5 读取哨兵验证新增0到5日×普通/严格模式12个场景；本轮后一处修复前8/12、修复后12/12。0到4日均无H5读取，5日进入读取路径（哨兵终止，未运行后续实际演进）。两套Worker测试为隔离场景，不是完整原生进程验证，不和核心回归简单相加。
- 原 factor-shadow-evolution.test.js 内保留原 strict watch 端到端正例，并增加非严格等待、重新封存越界拒绝、缺失H5时4日双模式等待、锁释放及目录无变更断言。语法编译通过，完整原生测试待CI。
- 源码：6a5b1c8e750d6ca3460954118d4025da4da4ea00（prereg blob 97c8fdc758a4564c19057fc4465b75153066decc）；Worker 最终 a8e532c746ef3762318abe83148782d5fa568f08（blob fe2c3c578a92d86b93188927000f0d07bff053d4）。测试：33e34163989b8e731b0d24704cee2d0df89a4d1c（blob 2d144df3cc70d8dee7682e9f148797209fd16620），201b967635157bba3971ee8a383ce1a822545e60（blob 03c2a51e003e995b33015e22a1966a6d8d21a90f）。四个远端文件均核对。
- 当前环境无法解析 GitHub 域名并取得完整工作树；本轮未完成原生全仓、真实模型或真实行情验证。#545 上轮 head 无工作流回执；总管 #427 仍是三项失败状态，未修改其他组测试或正式策略。原30项继续保持30项部分修复、0项最终完整验收。不合并、不部署。


## Follow-up acceptance delta (2026-11-27)

Frozen acceptance PR #549 at c61b77b does not contain the subsequent 11 commits through 26d83e4. Preserve the five changed worker/core/test files when integrating; do not replace them with the frozen snapshot. Recovery-only days are excluded from candidate holdout scores; fewer than five new days cannot pass promotion; missing IC differences remain null. Actual frozen factor definitions are checked at waiting, pre-holdout and evolution entry points, including canonical legacy weights.

Evidence: 23/23 preregistration tests executed in an isolated JS harness with simulated filesystem and deterministic digest (not native SHA-256); 6/6 recovery-window boundary cases using actual comparison/marginal modules with synthetic scorer; 6/6 isolated recovery gain cases. Native worker and combined regression remain required. No production weight changes, trading permission, merge or deployment. Original 02.1 native replay evidence is present in integration #427 job 140282724697; that job overall passed 6546/6553 with seven unrelated HTTP trading failures. Do not represent this as a clean combined acceptance.
