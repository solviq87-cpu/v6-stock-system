# daily_stock_analysis 对照与股票清单导入

核查日期：2026-11-14（北京时间）。V6 基线：`dev` / `92db2d2f64d130c21007915568d7292b14d9a0c4`。参考仓库：[ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)，读取到的源码树为 `70f250597e9a2b0afe2d7dd6b992c90926916105`。功能说明是上游宣称的支持范围，不是本环境实测的行情或盈利能力。

## 功能差异

| 能力 | 参考项目 | V6 当前依据 / 判断 | 本次处理或后续边界 |
| --- | --- | --- | --- |
| 多源行情、指标、研究策略 | 多源适配与策略报告 | `em.js`、`market-failover.js`、既有四体系及36种研究规则已存在 | 复用现有链路，不增加同义指标重复计分 |
| 决策证据与风险 | 结论、催化、风险、操作清单 | `stock-capture-workbench.js`、新闻证据、冻结假设与风险中心已有基础；既有静态工作台另有逐股依据 | 仍可完善统一报告排版；不能把“有展示”当成生产验收 |
| 批量股票导入 | 图片、CSV/Excel、粘贴；名称解析 | `research.html` 的采集入口原先只接受手填单个六位代码 | 本次新增粘贴、CSV/TSV/TXT预览、去重、逐只选择并接回现有采集 |
| OCR / 原生 Excel / 拼音补全 | 上游有对应导入和补全组件 | 本次未在 V6 找到同等完整入口 | 尚未实现；Excel 可复制带表头表格或另存 CSV UTF-8；不引入视觉模型费用 |
| 自然语言多轮问股 | Agent、会话及策略上下文 | V6 的研究智能体是研究执行流程，不等于聊天问答 | 值得后续做有来源引用的问答；遵守现有生产 OpenAI/ChatGPT API 禁入及零新增费用要求，不直接搬模型网关 |
| 多市场股票研究 | 上游说明覆盖 A/H/美/日/韩/台，能力有市场差异 | V6 主股票采集/策略契约以六位A股为主，外部市场背景不等于完整跨市场个股研究 | 必须先建立证券身份、时区、日历、币种和价格口径；本次不将外股硬转A股 |
| 历史报告对比 | 历史报告、上下文快照、可选历史信号比较 | V6 `stock-intelligence-memory.js`、冻结证据和前向验证已有历史基础 | 缺少同等便捷的统一报告差异视图；应消费原冻结版本，禁止用新数据改旧判断 |
| 新闻搜索与推送 | 多搜索服务、多通知渠道 | V6 已有新闻来源/修订链、情绪、飞书队列和回执 | 优先提高已接链路覆盖及可读性；新增搜索接口须核实配额和授权，多通道不能绕过私密隔离与唯一发送者 |

参考定位：[README](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/README.md)、[完整指南](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/docs/full-guide.md)、[市场边界](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/docs/market-support.md)、[导入解析](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/src/services/import_parser.py)、[证券身份](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/src/services/stock_list_parser.py)、[Agent入口](https://github.com/ZhuLinsen/daily_stock_analysis/blob/main/api/v1/endpoints/agent.py)。本次借鉴功能设计，独立编写 JS 实现，未复制上游 Python/React 源码或配置。

## 本次可用行为

入口：完整 V6 后端的 `/research.html` → “按代码采集并记住K线” → “导入股票清单”。保留全部旧入口和两张锁定主页。

- 无表头输入按纯股票代码列表解析；含名称/数量/价格的表格必须有唯一代码列。CSV遵守引号与转义；Excel复制的制表符表格支持代码/名称列重新排序，其他列不参与证券识别。
- 支持沪深股票六位代码、SH/SZ前缀及 `.SH` / `.SZ` 后缀。保留前导零；不把1补成000001，不从科学计数法、公式或名称猜代码。
- `sh000001`/`000001.SH`不能降级为深圳000001；交易所冲突、指数/ETF、北交所、港美日等暂不支持的输入有逐条原因。
- 重复代码保持原顺序，列出重复来源行；名称冲突提示核验。所有导入名称仅为用户文本，上市状态和证券身份未获外部认证。
- 限100 KB、1000行/条目、100只不同股票，超限整体拒绝；不静默截断。展示使用文本节点，不执行CSV公式或HTML。
- 预览和选择不请求行情、不保存浏览器长期数据。选择触发现有输入失效事件以清掉旧股结果；用户再点既有采集/读取按钮，继续受原权限及供应商预算控制。完成采集后的云端历史沿用已有机制，导入清单本身不冒充云端自选持久化。
- 换文本、文件、令牌、离线或离开页面时使旧文件读取和旧选择按钮失效；清空不会被迟到文件结果复活。

## 验证与范围

专项：`node --test tests/stock-list-import.test.js tests/stock-capture-ui.test.js`，20通过。语法检查、`git diff --check`、完整服务隔离HTTP启动通过。`V6_WEB` 原40项测试、构建、dist一致性通过。

全量命令：`V6_MODEL_PYTHON=<主运行环境Python> V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test`。本次3380项：3373通过、4失败、3跳过（可选LightGBM/XGBoost依赖未安装）。全量退出码1，不宣称全绿。

本地 Chromium 启动被环境拒绝：`process_singleton_posix.cc socket() failed: Operation not permitted`，尚未得到本地截图。新增 `scripts/ui-stock-list-import-browser-check.js` 并接入原浏览器CI，覆盖320/390/430/1536宽度、真实页面脚本、文件预览、清空、无自动采集、权限拒绝和XSS文本。远端执行结果以精确提交的CI为准，不能把脚本存在当浏览器验证通过。

本环境全量执行出现 `managed-publisher-runtime.test.js` 四项失败；用 `git archive HEAD` 提取未改动的基线源码和原测试后同样4失败/9通过，和本次导入无关，未放宽发布者校验。仍必须等待全量门禁，不据此自动合并。

不涉及真实推送、券商、付费服务、策略权重、账户数据或自动发布者。本次修改BO研究页，WorkBuddy当前单文件静态托管不会因此获得完整后端功能；未部署或宣称线上可用。回滚仅revert本批提交，不清除历史档案。
