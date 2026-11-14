# 追加十类公开模型、运行方式与页面模式对照

核对日期：2026-11-14；基线dev合并提交f75def9。新增N01–N10共10个独立官方来源，排除上批Chronos/TimesFM/Moirai/Kronos/RD-Agent/TradingAgents/FinGPT/Qwen八仓库。机器清单为[additional-models.json](additional-models.json)，包含32条实际阅读的固定README、许可、源码/协议路径、提交SHA和Blob SHA。初次分支读取的README/许可哈希已在固定commit根目录二次比对，10/10一致。

这里只比较设计和可采用条件。未下载模型、训练数据或权重，未安装上游依赖，未执行推理/训练/基准，未增加模型API或费用。准确率、时延、峰值内存均保留null；没有按宣传榜单排A股收益名次。

## 分类和取舍

| N01 [DeepSeek-R1 / R1-Distill](https://github.com/deepseek-ai/DeepSeek-R1/tree/0cf78561f1d51c84a21b2190626b21116d5c68bb) | 通用推理语言模型 | 按任务设推理预算，记录采样配置与完成/截断状态；模型、tokenizer与蒸馏底座分开固定 | 借鉴固定配置、预算和结果校验；大权重运行仅保留离线候选 | 推理/数学榜单不能证明A股收益；671B总参数与37B激活参数不能当作37B模型的加载内存。蒸馏Llama版本仍需核底座条款。 |
| N02 [GLM-4.5 / GLM-4.7 / GLM-4.7-Flash](https://github.com/zai-org/GLM-4.5/tree/170f20b2c10659008fdbc909d478bc2a75bc3627) | 通用推理与工具模型 | 逐轮选择轻量/深入模式并留存所用模式；工具结果与最终结论分开 | 优先借鉴运行模式显式化与模式配置留痕；不自动启用多轮思维或模型服务 | 4.7-Flash的30B-A3B是总参数/激活参数区别，不代表3B加载需求；网页/代码基准不是金融实测。 |
| N03 [InternLM3-8B-Instruct](https://github.com/InternLM/InternLM/tree/68fdc71330059255fd647abf28219ad11e8e4865) | 中文通用语言模型与会话示例 | 参数放侧栏，主要结果放主栏；轻量/深入模式和历史记录分别管理 | 优先借鉴侧栏/结果分区与模式分离；保留V6原权限、证据和会话档案 | 本地8B示例未做本机显存/延迟测试；深思文字不是可审计证据，不应把完整内部思维链作为股票结论依据。 |
| N04 [Mistral / Mixtral（旧官方推理库）](https://github.com/mistralai/mistral-inference/tree/9eaeb91c17450e09021b6065a1d5cc69876507c8) | 语言模型推理参考实现 | 模型、tokenizer和采样配置成套固定；EOS、最大输出和采样温度分开控制 | 只借鉴固定配置和停止语义，旧运行库不采用 | 仓库已归档；GitHub元数据和README均明确该库已归档，不推荐作为新生产运行时；Codestral22B、Mistral Large2等权重条款与Apache源码不同。 |
| N05 [Llama 3.2 / Llama 4 系列](https://github.com/meta-llama/llama-models/tree/0e0b8c519242d5833d8c11bffc1232b77ad7f301) | 开放权重语言/多模态模型与运行工具 | 模型代际、tokenizer、量化和分片配置成套固定；不同检查点维护各自许可与模型卡 | 借鉴完整配置身份与代际许可分离；不直接搬自定义许可源码 | 开放权重不等于Apache/MIT；Llama各代自定义社区许可与使用政策、分发署名等条件需分别核查；官方硬件说明不是本机资源测量。 |
| N06 [IBM Granite Time Series / TinyTimeMixers](https://github.com/ibm-granite/granite-tsfm/tree/31fa2f01573341f17e9997280f61481de18ce28c) | 时序基础模型与处理工具 | 预处理器拟合状态可序列化，随输入和版本留痕；校准集拟合与测试集预测分离 | 优先借鉴预处理和校准数据隔离的实验合同；本轮尚未实现校准训练 | scaler不能在完整未来数据上拟合；conformal方法不能在参与校准的同批样本上自证覆盖；本轮无真实模型校准、A股基准或收益实测。 |
| N07 [Gemma 3（旧官方PyTorch实现）](https://github.com/google/gemma_pytorch/tree/014acb7ac4563a5f77c76d7ff98f31b568c16508) | 轻量开放权重文本/多模态模型 | 明确模型规模、dtype、tokenizer与上下文配置；文本/图像预处理分开 | 只借鉴dtype/规模/预处理显式配置，旧库不采用 | 仓库已归档；GitHub元数据archived=true，不把旧库当新生产推荐；图像理解不能替代公告原文和K线数值；根Apache源码不能覆盖独立权重条款。 |
| N08 [MiniCPM5-1B / MiniCPM5-2B](https://github.com/OpenBMB/MiniCPM/tree/f4293a1a7bde05d1acce99488235792615fc241b) | 端侧小语言模型与工具协议 | 按硬件、文件格式和目标只选一种运行后端；工具名、允许参数、必填项和重复键严格校验 | 优先借鉴严格契约和运行前条件卡；保留固定工具白名单与禁止执行上传代码 | README的端侧性能不等于本机测速；不复制XML修补/宽松解析分支来绕过V6严格JSON合同；端侧模型不得成为账户或交易写入主体。 |
| N09 [Fin-R1](https://github.com/SUFE-AIFLM-Lab/Fin-R1/tree/06ead1e61ff77cad71dc409198b1a2575d748ecd) | 金融推理语言模型 | 按金融计算、专业知识、文本/表格任务分开验收；答案数值校验与证据逻辑校验分开 | 借鉴金融任务分类与数值/证据双校验，模型仅保留候选 | 7B金融推理榜单不等于A股方向或收益；固定仓库根无LICENSE文件/训练实现，README的Apache徽章不足以完成代码/权重/数据独立核验，不能直接搬未核权数据。 |
| N10 [Time-MoE](https://github.com/Time-MoE/Time-MoE/tree/915bfda4c78a544d62a2bec6ab22948423059236) | 稀疏时序基础模型 | 训练区间拟合scaler，测试区间只transform；上下文与预测长度有显式上限 | 优先借鉴训练/测试处理隔离和统计分母；预处理训练区间合同仍为候选 | README的通用时序结果不是A股实测；示例trust_remote_code需要固定和审读远程实现，不能照搬自动执行；不把未来动态变量当已知输入。 |

## 这次最值得V6采用的做法

1. **完整的实验身份。** DeepSeek模型/蒸馏底座/tokenizer、GLM逐轮模式、Llama量化/分片、MiniCPM后端/格式都表明：模型名字本身不是可重复实验身份。V6应把实际固定配置、输出类型和输入指纹关联，比较时让用户看清差别；未声明配置保持未知。根代理本轮选择实现的配置身份与配对标签可在验收后登记为采用，不能先写成功。
2. **按任务选运行方式。** MiniCPM5的官方部署路由按硬件、权重格式和用途选择一个后端；不把桌面演示、长期后台服务与网页静态托管混为一体。V6应把“只读公开目录”“导入结果评测”“本地候选推理（未启用）”“已授权后台分析”区分清楚，任何模式都不能暗中启动付费API或绕过唯一发布者。
3. **参数与结果分区。** InternLM web_demo.py将模式/参数放侧栏、主要结果放主栏，并分别管理普通和深入模式的会话。V6适合在研究内页做可筛选目录、并排比较和展开来源，手机改为纵向卡片；原锁定index.html/mobile.html无需改变。借鉴信息结构，不复制其普通聊天界面来替换股票分析。
4. **工具结果必须满足契约。** MiniCPM5的_build_tool_maps/_parse_function_block先核工具名、允许参数、重复键与必填项；流式增量与完整工具调用分开。V6现有报告/预测导入已经严格，宜复用现有校验而不是增加XML容错或把“看起来像调用”的文本执行。复制代码时还须保留文件SPDX和vLLM贡献者版权头；本批实际没有复制源码。
5. **预处理与校准分阶段。** Time-MoE BenchmarkEvalDataset先scaler.fit(train_data)，再transform(test_data)；Granite将预处理状态序列化并把校准train/predict分开。这些可成为后续输入合同候选：归一化方法、拟合日期、预处理指纹、校准集和测试集边界。根代理明确本批不新增预处理训练或校准实验，不能写成已实现。
6. **金融答案与事实分别核验。** Fin-R1的领域任务和答案/推理逻辑两轮筛选可启发把“数值计算正确”“有原文支持”“缺少时点/来源”分列。金融基准成绩不能替代投资结果；无需复刻它的训练数据或生成内部思维链。

## 许可与维护的具体差别

- DeepSeek-R1：固定根MIT；README对原版R1权重声明MIT，同时明确Distill-Qwen与Distill-Llama的不同底座来源和原许可，不把整个家族统称同一授权。
- GLM：根源码Apache-2.0；README对4.5/4.5-Air权重声明MIT。该仓库当前示例已使用4.7，4.7/Flash/量化检查点条款需各自读取，不能跨版本继承结论。
- InternLM3与MiniCPM：当前README声明代码与权重Apache-2.0，根LICENSE实际已读。第三方量化文件/历史模型仍按实际产物核对。
- Mistral：mistral-inference已归档；源码Apache-2.0不覆盖README明确列出的Codestral22B非生产MNPL、MistralLarge2研究MRL权重。旧库只保留方法参考，不推荐为新运行时。
- Llama：已读根许可和3.2 Community License，属于自定义条款，有代际、分发署名及其他条件；不能标为MIT/Apache或不加区分地称OSI开源。
- Gemma：旧官方PyTorch仓库已归档，代码Apache-2.0。权重从Kaggle/HuggingFace分发，未读取具体检查点条款，不声明权重Apache。
- Fin-R1：根目录无独立LICENSE，README Apache徽章仅为声明；仓库也没有完整训练实现。本批只借鉴任务/核验方法，不搬未核权代码或数据。
- Granite与Time-MoE：源码Apache-2.0已核读；独立检查点、tokenizer与训练集条款没有由源码许可推断。训练/测试或校准方法本身也未在本工程跑出成绩。

## 实际阅读范围

所列源码为抽样，不是全库审计；没有执行源码中的部署命令、外部模型API、技能指令或代码解释器。尤其MiniCPM的skills/minicpm5-deploy/SKILL.md在此仅是研究对象，不是已调用的本会话技能。目录维护状态来自官方GitHub metadata，固定文件URL及Blob SHA可在JSON逐条追溯。

结构化JSON已通过python3 -m json.tool语法检查；父代理对实际集成、回归、PR与CI单独负责，研究清单不自动代表采用、上线或收益验收。
