# 研究风险中心接通｜2026-11-13

基线为 `502ac72`。新增独立只读聚合 `src/core/research-risk-center.js`、编辑权限 GET `/api/research/risk-center`，以及现有 `research.html` 的独立区块与 `assets/research-risk-center.js`。锁定主页 `index.html`、`mobile.html`、原 `app.js`、现有四策略与交易风控均未改动。

## 使用与资料来源

研究页点击“读取现有风险证据”后才发出 GET，携带当前开发者令牌，使用 `cache:no-store`。服务端执行现有 `requireEditor`，查看权限和匿名请求不可读取；所有路由响应禁止缓存，非 GET 返回 405。查询参数不能指定本地文件路径或触发采集。

聚合读取以下既有内容：

- 市场及来源：`riskEvidenceView(state,now)` 的逐票原始报价时点覆盖、过期/未来/未知数量、板块与可选研究来源状态。列表接收时点不替代逐票报价时点；近期仍为未认证。
- 手工持仓观察：`readManualHoldingWatchFile`，优先使用 `V6_MANUAL_HOLDING_WATCH_FILE`，兼容既有 `V6_HOLDING_WATCH_FILE`。只有读者原有协议通过校验时展示成本浮亏、用户申报集中度和双源冲突；它不认证实际持仓，也不读真实账户。
- 新闻：`news-evidence-journal.query(root,{symbol:null,limit:50,now})`，目录来自服务端 `V6_NEWS_EVIDENCE_DIR`，默认 `data/news-evidence`。展示最新50个版本与全档案计数，撤稿、修订、被替代与未知分别保留。可见窗口内的修订数不冒充整个档案的修订总数。模块缺失、目录协议或链校验失败时显示 `unavailable`，计数为 `null`，不显示“0条风险”。
- 研究代理：`factor-research-agent.readAgentStatus(V6_FACTOR_AGENT_DIR)` 的已保存状态。未配置、校验失败和已暂停均明确保留；读取不会启动代理。

结果含 `supports`（已有证据支持的观察事项）、`contra`（冲突或限制结论的证据）和 `missing`（缺失/未认证/不可校验证据）。标题词或旧利好利空分类不进入确认消息判断。修订/撤稿仅表明证据变化，不推断股价方向。

整体 `riskScore:null`，无充分观察时 `status:'unknown'`；观察到浮亏、集中度或资料变化时为 `observed-concerns-unverified`。策略衰减固定为 `unknown`、估计值 `null`：现有流程状态和样本不足不能证明策略有效或失效。本批不发明综合风险分数、不改权重/评分、不发送消息、不启动行情采集。

## 私有结果生命周期

动态内容通过 `textContent` / DOM 创建渲染；原始链接只允许无用户名密码的 HTTP/HTTPS，并使用 `noopener noreferrer`。标题中的 HTML 保留为文本。

每次读取先清空旧结果。令牌 input/change、页面隐藏、pagehide 或离线均清空私有结果并增加请求代次；响应需同时匹配代次、当前令牌和可见状态才允许渲染。旧请求结束也不能重新启用较新请求的按钮。失败或返回结构无效时清空结果并显示风险未知。此模块不保存令牌或结果到浏览器存储。

## 实际验证

日志在交付工作区 `/workspace/remaining-output/risk-*`。这些是本地隔离验证，不是线上运行或供应商认证。

- 新增核心/页面/HTTP 行为用例：12项通过。真实 HTTP 用例在原基线失败（路由不存在），修复后通过。
- 联合既有市场风险视图、手工持仓、双源核验与研究权限专项：31项通过。
- 在隔离可执行副本中加入当前逐票报价视图和真实新闻模块，12项新增用例通过；实际新闻原始→修订→撤稿链及篡改后的不可用行为均经运行。正式源码不跨工作树引用。
- HTTP 测试复制可执行代码与公开目录说明文件，使用随机测试令牌与合成持仓；禁用采集启动，阻止 HTTP/HTTPS/socket/TLS/fetch 出站，并在风险读取期间阻止同步文件写入。验证主/旧环境名优先级、编辑/查看权限、405、不可缓存、输入字节不变、无新建研究目录、无出站尝试。
- Node DOM 测试覆盖点击才请求、bearer/no-store、文本/安全链接、令牌改动、隐藏、失败、并发旧响应。
- Chromium 对实际研究页与聚合模块的隔离本地服务检查 375px、1366px CSS 视口；无水平溢出，标题不生成 HTML，延迟响应在令牌改动后不能恢复内容。新闻为合成协议样本，截图为测试资料，未冒充真实来源。截图与日志：`risk-browser-375.png`、`risk-browser-1366.png`、`risk-browser.log`。
- `npm run check`、新增模块/资源语法检查、`git diff --check` 已执行通过。全量集成回归由根任务统一运行；真机、生产读取、原图1:1视觉验收未完成。

重跑专项：

```sh
node --test tests/research-risk-center.test.js tests/research-risk-center-ui.test.js tests/research-risk-center-http.test.js tests/risk-evidence-view.test.js tests/manual-holding-risk-watch.test.js tests/manual-holding-cross-source.test.js tests/factor-agent-http.test.js
npm run check
node --check src/core/research-risk-center.js
node --check public/assets/research-risk-center.js
git diff --check
```

## 回滚

回滚本提交，移除新增路由、独立研究页区块及资产即可；本批不写入业务资料，无账户或新闻迁移需要撤销。不要删除已有手工持仓、新闻或研究代理的私有档案。其他研究入口有各自既有权限与隐私生命周期，本批只约束新增风险中心。
