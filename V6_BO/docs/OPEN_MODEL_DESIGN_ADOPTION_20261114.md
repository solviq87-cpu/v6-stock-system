# 公开模型、运行方式与界面设计综合采用记录

基线为已合并#225的`dev@f75def9cecb22856defd8e33fe1d02738c426846`。用户要求继续查找开源模型，并把运行、布局、交互等可取之处一起采用。本轮新增10个模型/家族或其运行参考、7个界面/运行项目，与原24来源合计41个公开来源。这里包含开放权重、带附加条款的源码项目、规范和闭源交互参考，**不是41个开源大模型**。

入口：研究页顶部“模型与设计资料库”→`/model-library.html`。界面只读公开资料，不需私有令牌，不读取持仓/研究历史，不调用模型或收集分析输入。原研究页八项功能和预测档案保留，两张锁定主页字节不改。

## 已经采用的具体功能

| 来源设计 | V6实际落点 | 用户获得的能力 |
| --- | --- | --- |
| Open WebUI模型目录、InternLM参数侧栏 | 独立资料库筛选侧栏与主结果区 | 搜索名称/功能/许可，任务类别及采用状态组合筛选；手机单列，电脑侧栏与结果区 |
| LibreChat选择与比较、模型/配置分开 | 最多三项并排对照，跨任务说明 | 同字段看借鉴点、运行方式、限制、源码/权重许可、固定版本和采用位置；不合成收益总榜 |
| AnythingLLM引用弹层与来源追溯 | 每项来源折叠与固定文件/Blob引用 | 查到读过的具体文件、版本与限制，不只看模型名称 |
| 模型精确配置、输出类型分别评测 | 原预测配对API/研究页成绩单 | 同名同版本的不同种子/温度/采样参数可区分；A/B均展示完整配置指纹与均值/中位数类型，不把不同输出口径混为一组 |
| 本地引擎/服务/前端分层 | 资料库分别展示运行方式、硬件待测与界面功能 | 区分模型、llama.cpp/Ollama/vLLM等运行层及前端；浏览不会自动拉模型或启动服务 |
| 有界运行队列与派发时点核验 | 原WorkBuddy采集队列`marketWire` | 睡眠唤醒后重查deadline；实际派发后重新锚定1050ms间隔，存储失败仍等传输结束后释放锁；未安装LLM引擎 |
| 可复核导出 | 下载已选对照JSON | 带原来源、版本、许可、采用状态及未知实测项，不含账户和私有分析 |

本轮独立实现上述通用设计，没有复制上游代码或视觉资产，没有加入模型依赖、下载权重或收费API。Dify/Open WebUI额外条款、Llama/Gemma自定义许可、Fin-R1缺独立许可、已归档参考仓库均在目录中保留；不能用根MIT/Apache替代权重、底座或数据许可。

## 全部来源按任务和采用状态对账

“设计已落实”仅指列明的V6实现位置；不表示该上游模型已安装或跑过。原16来源的采用记录是已有实现对账，不能当作本轮新写的16项功能。

| ID | 来源 | 类别 | 状态 | 具体借鉴/取舍 |
| --- | --- | --- | --- | --- |
| S01 | [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis/blob/70f250597e9a2b0afe2d7dd6b992c90926916105/src/schemas/analysis_context_pack.py) | 研究流程 | 设计已落实 | 来源、反证与失败阶段分别记录 |
| S02 | [Qlib](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/docs/component/recorder.rst) | 验证评测 | 设计已落实 | 输入指纹、实验版本和可知时点固定 |
| S03 | [QUANTAXIS](https://github.com/yutiansut/QUANTAXIS/blob/232aa7ac9869966108f02a8fff85f1f7b09a9ce2/QUANTAXIS/QAData/data_resample.py) | 数据与规范 | 仅参考 | 交易时段及数据口径不可相互替代 |
| S04 | [Qbot](https://github.com/UFund-Me/Qbot/blob/f0425ae4ae8bd02b79656b8f7039f4cd6874095e/qbot/engine/backtest/backtest_base.py) | 验证评测 | 设计已落实 | 同日期简单基线与费用口径分开 |
| S05 | [QuantConnect LEAN](https://github.com/QuantConnect/Lean/blob/82d26047e95a89b53c9cbe02b67efaa3c4455ed9/Common/Data/Market/Dividend.cs) | 验证评测 | 设计已落实 | 公司行为及前视偏差的未知证据保留 |
| S06 | [Freqtrade](https://github.com/freqtrade/freqtrade/blob/5197bedab82559fac6be6c1539c64b94368fb91c/docs/lookahead-analysis.md) | 验证评测 | 设计已落实 | 未来数据不能改写首次观察结果 |
| S07 | [Ghostfolio](https://github.com/ghostfolio/ghostfolio/blob/f58465aea78dd0c386cf9bcde5a22fbcf508911a/apps/api/src/models/rules/account-cluster-risk/single-account.ts) | 验证评测 | 设计已落实 | 持仓暴露、集中度和来源质量集中展示 |
| S08 | [Portfolio Performance](https://github.com/portfolio-performance/portfolio/blob/e8f60849cf2ebd44e56a5b793cde5cdffe15ae12/name.abuchen.portfolio/src/name/abuchen/portfolio/math/IRR.java) | 验证评测 | 仅参考 | 区分资金加权与时间加权收益的适用前提 |
| S09 | [OpenBB核心及Workspace文档](https://github.com/openbq-org/OpenBB/blob/e43353a82815ff9ba56ad1b7ad47c32729dcf314/openbb_platform/core/openbb_core/provider/abstract/fetcher.py) | 界面与交互 | 仅参考 | 数据状态与展示组件分开 |
| S10 | [Evidently](https://github.com/evidentlyai/evidently/blob/34771fe41c08ca074d96a52aaf4a45cd640cbaf5/src/evidently/presets/drift.py) | 验证评测 | 仅参考 | 漂移与样本覆盖分开验收 |
| S11 | [MLflow](https://github.com/mlflow/mlflow/blob/480c3b01730007a11d536412f9094e99d47f9252/mlflow/data/dataset.py) | 研究流程 | 设计已落实 | 保存数据、参数、版本与产物引用 |
| S12 | [OpenLineage](https://github.com/OpenLineage/OpenLineage/blob/c41626e99af0a02ad95a2805979167ad948ecb7b/spec/facets/DatasetVersionDatasetFacet.json) | 研究流程 | 设计已落实 | 结论与原数据版本建立可追溯引用 |
| S13 | [OpenTelemetry](https://opentelemetry.io/docs/concepts/signals/traces/) | 研究流程 | 设计已落实 | 统一阶段、耗时与故障位置 |
| S14 | [LangGraph JS](https://github.com/langchain-ai/langgraphjs/blob/fa426b293b6ecccbf62b4f262475777b4bf86673/libs/checkpoint/src/base.ts) | 研究流程 | 设计已落实 | 已存阶段和版本可恢复，禁止重复写入 |
| S15 | [Great Expectations GX Core](https://github.com/fivetran/great_expectations/blob/eadca9dd020d37f039ba9fd69a7e0b826acaced3/great_expectations/core/expectation_suite.py) | 数据与规范 | 设计已落实 | 输入质量契约先于分析与保存 |
| S16 | [TradingView](https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/) | 界面与交互 | 仅参考 | 回放、筛选和撤销的交互说明 |
| M01 | [Chronos-2 / Chronos-Bolt](https://github.com/amazon-science/chronos-forecasting/blob/1224fafa91e1ecd6674f5204066b159e40b5e4a1/README.md) | 时序预测 | 设计已落实 | 分位数预测与区间校准；过去变量与预先已知未来变量分开 |
| M02 | [TimesFM 3.0 / 2.5](https://github.com/google-research/timesfm/blob/918df02c9d366b2145bc5876135fa2131d3ed2a6/README.md) | 时序预测 | 设计已落实 | 点预测与分位数分开评价；固定版本与基线 |
| M03 | [Moirai 2.0 / Uni2TS](https://github.com/SalesforceAIResearch/uni2ts/blob/cfd46d4510ed8896f263116f32928eede05b0a75/README.md) | 时序预测 | 设计已落实 | 观察掩码与缺失分开；分位数评价 |
| M04 | [RD-Agent](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/README.md) | 研究流程 | 设计已落实 | 假设—实验—反馈记录；代码/数据/配置一致的版本比较 |
| M05 | [Kronos](https://github.com/shiyu-coder/Kronos/blob/67b630e67f6a18c9e9be918d9b4337c960db1e9a/README.md) | 时序预测 | 设计已落实 | 模型与tokenizer成对固定；记录采样温度、top-p、路径数/随机种子 |
| M06 | [TradingAgents](https://github.com/TauricResearch/TradingAgents/blob/9fa1196fffbcfd9de5146d2dd2869df84ab99838/README.md) | 研究流程 | 设计已落实 | 支持与反对意见按证据拆开；价格与结论绑定 |
| M07 | [FinGPT / Forecaster](https://github.com/AI4Finance-Foundation/FinGPT/blob/ac5c5443fbeeafad801e7a3c188e4f24cfaad4d8/README.md) | 金融文本 | 待条件实测 | 利好/担忧/缺失分开；按公司与日期对齐新闻 |
| M08 | [Qwen3 / Qwen3-2507](https://github.com/QwenLM/Qwen3/blob/7a2f61ffc7a20d47efcd2bf97f6f2bf52729042e/README.md) | 语言与推理 | 待条件实测 | 模型/模式/提示模板与结果契约固定；输出与来源引用独立校验 |
| I01 | [Open WebUI](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/README.md) | 界面与交互 | 设计已落实 | 模型搜索、类型筛选及结果为空时的明确状态；目录筛选与运行端点分开，来源片段独立展开 |
| I02 | [LibreChat](https://github.com/LibreChat-AI/LibreChat/blob/fad2c51da41bb46c9cdd44a720cea4df0d47876b/README.md) | 界面与交互 | 设计已落实 | 搜索结果与模型提供方分组；键盘可达的选择和明确当前选择 |
| I03 | [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm/blob/4d09fa5f730698d39f1d783e47316744b260a700/README.md) | 界面与交互 | 设计已落实 | 桌面来源侧栏与手机单独来源详情；把来源标题、片段和限制放在模型结论旁边 |
| I04 | [Dify](https://github.com/langgenius/dify/blob/e07c1f42b94e349ddfaf76f31f356b323f7f288c/README.md) | 研究流程 | 仅参考 | 运行中/部分成功/失败/停止/暂停分开；节点追踪、重试详情、输入输出各自查看 |
| I05 | [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/32bdc3a89e6528d3e419024c833c5dabf32c7541/README.md) | 运行方式 | 待条件实测 | 量化精度、上下文与并发上限显式记录；空闲/排队/运行槽位及耗时分开 |
| I06 | [vLLM](https://github.com/vllm-project/vllm/blob/5fad73d1221d61446fb178bb0bf9151482ac43d0/README.md) | 运行方式 | 待条件实测 | 按排队请求数与token预算拒绝过载；取消/断开请求释放计算资源 |
| I07 | [Ollama](https://github.com/ollama/ollama/blob/a5864fcb33969705de3c0ebfedf4b2a16c970bcc/README.md) | 运行方式 | 待条件实测 | 有界等待队列、明确server-busy；排队时取消或超时即不启动加载 |
| N01 | [DeepSeek-R1 / R1-Distill](https://github.com/deepseek-ai/DeepSeek-R1/blob/0cf78561f1d51c84a21b2190626b21116d5c68bb/README.md) | 语言与推理 | 待条件实测 | 按任务设推理预算，记录采样配置与完成/截断状态；模型、tokenizer与蒸馏底座分开固定 |
| N02 | [GLM-4.5 / GLM-4.7 / GLM-4.7-Flash](https://github.com/zai-org/GLM-4.5/blob/170f20b2c10659008fdbc909d478bc2a75bc3627/README.md) | 语言与推理 | 待条件实测 | 逐轮选择轻量/深入模式并留存所用模式；工具结果与最终结论分开 |
| N03 | [InternLM3-8B-Instruct](https://github.com/InternLM/InternLM/blob/68fdc71330059255fd647abf28219ad11e8e4865/README.md) | 语言与推理 | 待条件实测 | 参数放侧栏，主要结果放主栏；轻量/深入模式和历史记录分别管理 |
| N04 | [Mistral / Mixtral（旧官方推理库）](https://github.com/mistralai/mistral-inference/blob/9eaeb91c17450e09021b6065a1d5cc69876507c8/README.md) | 运行方式 | 仅参考 | 模型、tokenizer和采样配置成套固定；EOS、最大输出和采样温度分开控制 |
| N05 | [Llama 3.2 / Llama 4 系列](https://github.com/meta-llama/llama-models/blob/0e0b8c519242d5833d8c11bffc1232b77ad7f301/README.md) | 语言与推理 | 待条件实测 | 模型代际、tokenizer、量化和分片配置成套固定；不同检查点维护各自许可与模型卡 |
| N06 | [IBM Granite Time Series / TinyTimeMixers](https://github.com/ibm-granite/granite-tsfm/blob/31fa2f01573341f17e9997280f61481de18ce28c/README.md) | 时序预测 | 待条件实测 | 预处理器拟合状态可序列化，随输入和版本留痕；校准集拟合与测试集预测分离 |
| N07 | [Gemma 3（旧官方PyTorch实现）](https://github.com/google/gemma_pytorch/blob/014acb7ac4563a5f77c76d7ff98f31b568c16508/README.md) | 语言与推理 | 待条件实测 | 明确模型规模、dtype、tokenizer与上下文配置；文本/图像预处理分开 |
| N08 | [MiniCPM5-1B / MiniCPM5-2B](https://github.com/OpenBMB/MiniCPM/blob/f4293a1a7bde05d1acce99488235792615fc241b/README.md) | 语言与推理 | 待条件实测 | 按硬件、文件格式和目标只选一种运行后端；工具名、允许参数、必填项和重复键严格校验 |
| N09 | [Fin-R1](https://github.com/SUFE-AIFLM-Lab/Fin-R1/blob/06ead1e61ff77cad71dc409198b1a2575d748ecd/README.md) | 金融文本 | 仅参考 | 按金融计算、专业知识、文本/表格任务分开验收；答案数值校验与证据逻辑校验分开 |
| N10 | [Time-MoE](https://github.com/Time-MoE/Time-MoE/blob/915bfda4c78a544d62a2bec6ab22948423059236/README.md) | 时序预测 | 待条件实测 | 训练区间拟合scaler，测试区间只transform；上下文与预测长度有显式上限 |

完整固定SHA、逐文件Blob、许可/运行条件及采用位置在[唯一资料目录](../config/open-model-library-20261114.json)；公开构建产物由`scripts/build-model-library.js`生成，[新增十项细读](ADDITIONAL_OPEN_MODELS_20261114.md)和[界面/运行细读](OPEN_MODEL_INTERFACE_PATTERNS_20261114.md)分开保留。旧来源记录不覆写。

## 候选和不能据此声称完成的事项

- DeepSeek/GLM/InternLM/MiniCPM等中文解释、事实提取与严格结果契约值得离线比较；尚无本系统准确率、时延、显存或证券收益实测。
- Granite与Time-MoE的独立校准、训练区间拟合预处理仍需新增可审计样本和实验；本轮没有把这些候选标成已实现。
- 模型运行需要按具体权重、量化、上下文、并发和硬件测量；激活参数不能冒充加载内存。轻量变体也不保证家用电脑可用，运行库内存表不作为实测。
- 不用原始推理文字作可执行指令或独立证据，不执行上传代码；原严格预测封存、真实行情隔离、私有权限、预算和15秒报价门禁保持原约束。
- 本轮不恢复缺失的受信发布运行文件、不新增发布者。静态目标不能运行完整Node/Python后台；代码/CI/合并与线上发布单独核验。

## 验证、失败修复与恢复

新增目录测试核验旧24来源及固定版本无丢失、41个唯一来源、公开构建一致、采用位置存在、许可限制可见；拒绝虚构实测、重复来源、凭据URL、错版本引用及非法路径。浏览器覆盖搜索/组合筛选/三项上限/键盘/来源安全/下载/异常重试及320/390/430/1536四视口；还使用实际41项目录检查。

实际完整server隔离检查先复现：未认证访问新页面被数据锁返回JSON。修复仅显式放行`/model-library.html`和`/assets/model-library-catalog.json`并给JSON正确MIME；没有放开任意JSON路径。真实HTTP复验页面、目录可读，其他JSON与账户操作仍受原门禁保护。

基线独立备份`base-f75def9.tar` SHA256`6d0cd3be6d953531fe0a8af173d687a035d16f9d3ee9148104691f29b01880e7`。回退revert本批提交即可；不迁移或删除账户、研究和预测档案。资料库首轮本地全量3530项：3527通过/0失败/3可选ML跳过；模型27项、关联77项、目录3项、交接7项、网页40项/构建/dist、打包12项、完整服务隔离HTTP及运行依赖/工作流审计通过。资料库合成与实际41来源各320/390/430/1536四视口通过，预测页四视口的完整配置显示通过。最终精确head CI、PR合并与合并后CI以PR回执为准。

复现命令（V6_BO目录）：

```sh
node scripts/build-model-library.js --check
V6_MODEL_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node --test tests/model-forward-evaluation.test.js tests/open-model-library.test.js tests/research-workspace-http.test.js
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-model-library-check.js
NODE_PATH=/opt/codex/cua_node/lib/node_modules V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-model-forecast-check.js
node tests/full-server-isolated-smoke.js
```


### 最终CI发现的运行边界与修复

PR#227首轮浏览器在旧采集队列测得1049ms，严格1050ms断言失败；未降低门槛或以重跑代替修复。原先从预算预留时间计算下次派发，首请求存储/初始化多耗1ms会缩短真实请求间隔；单次睡眠也没有防提前唤醒。现循环重读预算、截止期、取消/会话/冷却与当日上限，并以同步开始传输后的时间延长间隔；原单并发、计次一次和队列30秒上限保留。派发后持久化失败也先消费并等待在途传输，避免未处理拒绝或提前解锁。

四项新增故障检查在原代码形成40通过/3失败，修后43/43通过，包含可复现1ms存储耗时、提前唤醒、派发后存储失败与拒绝、远期deadline不能占锁一小时。此改动只完善原采集运行边界，不接模型或改变交易条件；运行修复后的静态浏览器整组10/10通过；最后完整回归、精确head及合并后CI见[PR#227](https://github.com/solviq87-cpu/v6-stock-system/pull/227)机器回执。
