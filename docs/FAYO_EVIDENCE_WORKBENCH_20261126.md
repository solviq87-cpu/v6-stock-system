# FAYO 新闻、筛选、研究解释与个人复盘（11 / 15 / 16 / 17 / 19 / 27）

统一基线：dev `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。前一阶段提交 `fa551abb934d7a7f3730f3d9a2913964f00b3279`，此次在其上增量实施。基线是可恢复的 Git 源码对象，不是已验收的生产备份。

## 完成清单（代码实施，不等于生产验收）
|任务|实现和证据|运行依赖/边界|
|---|---|---|
|11|原 news-evidence-journal 增加向后兼容 structured 和 asOf/关联修订；fayo-workbench.newsContext 同源关联公司、行业、原持仓、冻结计划；共用新闻界面|正式披露、独立认证、原文与生效时间须由合法来源实际供给；历史不借当前持仓|
|15|fayo-workbench.replaySeries/replayMarkers；同股入口、日涨跌幅共同时间轴、10/20/40日、日期筛选和原记录引用；日报增加原卖出回执|同源日历、封存板块/指数序列与日报需存在；旧日报缺卖出明细不补造；未归档信号/风险/成交标未知|
|16|原 command-selection 确定性规则、编辑/执行预览；编辑者保存/读取跨端模板，复用 workspace journal preset；观察者只在会话内|全市场覆盖不足明确拒绝，不伪称全市场筛选；禁止自然语言自动交易|
|17|四类原规则引用、同条件历史样本按原 scorecards 观察过滤；显式本地模型复用 single-model-interface，响应引用校验/失败回退|本地 Ollama 由操作者合法安装并启用；无凭据/无模型状态可见；不声称实际部署端模型已运行；最强反对无同尺度排序时不虚构|
|19|原执行日报及原人工日志/已对账模拟结算，纪律改进与下一次独立同类计划回执核验|人工记录并非券商认证；早退时限、违规重复与策略归因无证据保持未知；历史模式不使用当前可变人工日志|
|27|删除 server.js 中旧正面新闻加分、概率加成、降低推送门槛的路径；保留风险警示/原执行校验；所有新输出 canTrade:false，模型无交易工具或自由动作|最终集成复核其他组扩展接口及整个执行链，负面风控不放宽|

## 兼容接口合同
仅扩展现有 /api/research/workspace，沿用编辑身份、主副角色、原工作器和审计链。GET panel=templates；panel=news[&symbol=六位代码][&asOf=Unix毫秒][&limit=1..100]；panel=replay/history&symbol=六位代码&runId=64位哈希[&asOf=Unix毫秒]（history 必须提供 runId）；panel=discipline[&date=YYYY-MM-DD][&asOf=Unix毫秒]。原接口不变，全部 GET 只读；只允许历史截点不晚于当前服务器时间。POST action=fayo-save-command,value=支持的中文条件,requestId；action=fayo-explain,symbol,runId,asOf,question（support/opposition/missing/invalidation），编辑者显式操作。模板以原 preset 日志保存 scope=selection-command-only，不进入旧模板列表；无新账本、账户、消息、策略、独立采集链。模型环境变量 V6_FAYO_RESEARCH_MODEL_ENABLED=1、V6_FAYO_RESEARCH_MODEL_ID、V6_FAYO_RESEARCH_MODEL_URL（仅 127.0.0.1 的 /api/chat），缺失保持未配置。研究结果不进入生产交易参数。

新闻 structured 可选数组，每项 field/value/quote，字段 subject/industry/eventType/scale/effectiveAt/progress/disclosureKind；原正文包含逐字 quote，quote 包含 value，不能将推断写成已证实事实。旧记录哈希不变。日报 checklist.items[].exits 仅投影原权威 context.sells；未核对/旧版本不猜测。

## 六组协调
查阅活动 PR #353（策略治理）、#356（高级风控及锁安全）、#357（增强研究）；#356 与本组共同修改 server.js，#353/#356/#357 与本组共同修改 HANDOFF/DEPLOYMENT。第一组逐差异整合，不能整文件覆盖；保留所有门禁、原账本和锁改进。#357 使用本组解释及原统计接口，不另写收益计算。第一组统一发布版本、SW revision、66项矩阵、整合后的回归和生产部署。

## 验证状态
新 tests/fayo-workbench.test.js、原 tests/fayo-event-research.test.mjs 和 research-workspace-http.test.js 增量覆盖；当前工作容器不能解析 GitHub 主机，无法完整 clone；对新增及修改模块执行 V8 语法检查，不等于 Node 测试、HTTP、真实浏览器或生产验收。精确 SHA 的 GitHub Actions 结果另查，严禁用旧提交的绿色结果作为当前验收。无生产部署、实盘、真实通知、购买服务或已验证冷备。第一组应运行原全量、隔离HTTP、桌面/手机浏览器、权限/账本/恢复测试，并对真实来源和本地模型做单独运行确认。
