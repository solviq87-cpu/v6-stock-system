# 第一组 G04/G05 第二批工程专项（未发布）

## 基线与复用

- 父提交 `f616dd961a126727667f2533599740b68e4d6550`（#615），主线 dev 仍为 `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`。F统一候选#612 `14ec08aa50d31660b0f4f46c29a95cc11ac1bc6f` 仍独立，复用其审计脚本 blob `ff011e35b7ba3e960c16a2d6ecaffa8fdf3e24eb` 及三个已有测试 blob `b601f64b438b70aed7faf0f3d4bf9af332b271de`，不另造审计框架。
- 本批开始时 #615 父提交六个工作流尚在排队或运行，不能把它算作新提交通过。
- G04原TAP/续接修复保留，原CI与逐提交门禁不降级。新增原noopenai步骤内的专项测试，沿用unittest及原Git读回，不增加依赖。新旧候选共享此审计路径和CI步骤，总管需采用本次补强版，保留#612其余成果。

## G04/G05 实际整改

1. 审计拒绝错误Git根、空扫描、不可读/缺失/非UTF-8文件、链接或非普通文件替换；成功回执报告真实扫描文件数量，失败只显示路径和风险类别、不输出配置值。
2. 保留#612外部静态页面资源、OpenAI/Anthropic/DeepSeek/Gemini等已有指标检查；增加.env系列、Windows脚本、Dockerfile/Procfile变体、OpenAI ESM副作用与子路径导入、npm锁和别名、Python规范化依赖名称。
3. 不阻拦合法原文链接、内嵌或本地静态资源、本地模型名称、现有合法金融数据路径；不新增外部API或采购，不修改生产逻辑、权限、交易、UI、发布者。
4. 局限：静态规则不是完整SDK运行追踪、混淆代码检测、遥测审计或网络隔离证明。完整树静态扫描、新SHA全量CI、真实部署与禁外网启动由实际回执另验。本地容器无GitHub DNS，无法在此完整checkout、安装、做已知漏洞数据库与传递依赖联网核验，不伪造结果。

## 实际专项测试（Python 3.13.5，Git 2.47.3）

命令：`python -m py_compile scripts/audit-no-openai-runtime.py tests/test_runtime_network_dependencies.py`；`python -m unittest discover -s tests -p test_runtime_network_dependencies.py -v`。每个新增CLI用例在临时真实Git仓库运行，全部使用合成数据，无真实密钥、外部API、账户或网络调用。

- 修前：4/10测试方法通过，6个方法失败（含subTest展开10个失败事件），7.355秒。
- 修后：10/10，0失败，8.136秒。三个原有用例全保留，新增7个方法。源码语法检查通过。
- 修后本地实际Git blob：`18c829ee1a17f7c5b432a067a226d8df6ddc7f08`、`61febebb02c8c792fd9efbace88d3af8df1ccc5f`。远端树必须逐blob核对后提交；未运行全量。
- 新增方法：missing_or_undecodable、symlink、empty_runtime_scope、unrelated_git_root、dotenv_and_windows_launcher、sdk_aliases_subpaths_and_python_names、legal_local_control。原负例与正常对照全部保留。
- 未启用任何测试缓存，未改原CI的源检查、全量回归、逐提交覆盖、浏览器等门禁。G04.7最终全集成回归交总管，开发前置与本组专项仍分别保留。

## 依赖及模型清点（声明/锁文件证据，非运行认证）

| 范围 | 实读证据与结论 |
|---|---|
| V6_BO/package-lock.json | blob 24b191b0aa18fc9227bbac9f790273502eff7a7e；lock v3，2个非根条目均有版本、完整性、许可元数据，MIT/Apache-2.0，无声明hasInstallScript。V6_BO package.json仅声明TypeScript 5.9.3开发依赖，Node >=22.6。 |
| V6_WEB/package-lock.json | blob 0108be787c2d3cd08cf98ee6ad280b25d52791a8；lock v3，75个非根条目均有版本、完整性、许可字段，1个esbuild安装脚本。原CI npm ci --ignore-scripts --no-audit --no-fund保持；未运行安装或验证所有实际包内容。 |
| Python研究/模型 | 原requirements-models、requirements-models-optional、requirements-research-sources、requirements-six-photo-sources直接版本固定，保留独立可选环境。模型使用scikit-learn及可选lightgbm/xgboost；行情SDK与可选研究来源不因此获得真实行情权限。传递依赖/构建轮子尚未逐哈希锁定，不宣称离线可复现。 |
| streamlit_readonly | requirements.txt存在按Python版本区分的版本范围；未将范围冒充精确锁，须独立兼容测试后收口，不擅自改变版本。 |
| 模型及许可 | public/assets/model-library-catalog.json 原目录声明53个参考项目、未下载上游权重、未新增模型API。原上游许可与依赖清单保留。目录不等于本地安装、真实推理或权重许可认证；实际模型权重及第三方文件仍待盘点。 |

G05.1/2/3/4/5/6/7/8/9/10/13/14有上述部分证据，已知漏洞、实际遥测、全量许可/权重与完整离线验证不得标记完成。G05.11/12/15/16本批坚持不替换稳定方案、不增加依赖/外部API、不绕过访问限制；没有改变已有真实行情来源。

## 仍需继续

本批不是32项完整验收：待当前组合全量CI、全树静态审计、依赖实际安装/传递风险、测试影响图与旧接口消费、授权及禁网现场。第一批尚未完整验收，第三批G06/G07仍按任务书推进。总管负责合并及最终发布；主线保护问题保持交接，不自行改仓库设置。回滚只恢复本批文件或对应提交，不覆盖原权威账户、数据卷及历史。
