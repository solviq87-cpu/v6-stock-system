# 板块联动、公开资金与个股历史研究

本轮开发起点为 `4515ef2135693e82823cbcba78ce39f71de6e1d3`；开发期间 PR #176 已由仓库账号合入 dev，已同步最新基线 `6d419a4e07c50d24392e8df67822b0085cc97fe6`，本轮另建 PR。用户已授权修复正确性问题及增加研究能力。原始 ZIP 仅作历史参考，本轮不覆盖新代码。两张主页字节、正式策略参数和账户订单协议保留；内页入口 `/research.html`。

## 具体变化

1. 公开资金字段按官方 AKShare 源码复核：东财 f104 为上涨数、f105 为下跌数，无法据此证明完整成员总数；f66 为超大单、f72 为大单。缺失保持 null，有效零值不再被忽略。估算主力净额包含大单与超大单，展示不得重复加计。东财订单大小分类与同花顺主动买卖口径不相加，也不能识别真实机构账户身份。
2. 板块关系按提供方、分类版本、行业/概念及代码确定身份。提供至少20个连续匹配交易日，才能计算同日 Pearson 相关与去市场波动相关；另列成员 Jaccard 重叠、3/5日资金连续性。相反流向不能证明两板块之间有真实资金转移。分类/成员变化、缺日、未来观测及常数序列均明确未知。概念重叠的资金不能加成全市场资金。
3. 逐票历史保存完整有效 OHLCV、来源、价格口径和逐日可得/状态证据。修订产生新版本；原子发布避免覆盖，进程中断留下的未提交临时文件不遮挡已提交历史。状态/公司行动证据未知时可以保留原始档案，但不伪造可预测样本。相同冻结预测的重复封存只计一次前瞻样本。
4. 方向预判为20日趋势与5日动量状态的历史条件频率，至少20样本，显示样本量、Wilson 区间、滚动样本外 Brier 与基准误差。涨停标签须未复权价格及事前已知的逐日涨停价、参考价、交易状态。不是用策略分数转换胜率，也不默认所有股票10%涨停。新数据只能验证已经封存的预测；今天导入旧数据不会成为过去作出的前瞻预测。
5. 形态研究复用既有 K 线规则，按当时已确认形态统计下一明确交易日上涨、下跌、平盘及实际封板。严格按可得时点、交易状态、公司行动及连续日历筛选；主板特有形态只接受逐日事前分类，不把当前身份回填过去。这是历史关联，不等同于新样本预测或净收益。
6. 新联动报告把市场宽度、板块相对强度、资金、技术形态、缺失证据和风险冲突并列展示，保持原股票顺序。当前资金/情绪不会回填为历史训练特征。报告、记忆及采集始终不能交易、推送或自动晋升正式权重。

## 来源及公开接口

参考项目及许可：

- [AKShare（MIT）](https://github.com/akfamily/akshare)：[资金字段](https://github.com/akfamily/akshare/blob/main/akshare/stock/flow/stock_fund_em.py)、[行业字段](https://github.com/akfamily/akshare/blob/main/akshare/stock/board/stock_board_industry_em.py)、[涨停池字段](https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_ztb_em.py)。本轮使用固定公开上游端点，不引入完整SDK。
- [efinance（MIT）](https://github.com/Micro-sheep/efinance)：可参考接口，但相同东财上游不算第二个独立来源。
- [CZSC（Apache-2.0）](https://github.com/waditu/czsc)：多周期确认思路参考；本轮不引入其Rust依赖，不把未来确认的拐点回填过去。
- [Qlib（MIT）](https://github.com/microsoft/qlib)：公开因子及研究流程参考，因子实现见上一轮报告。Qlib本身不是A股实时数据源。

公开服务的可用性、数据许可和实时性须分别核验，开源软件许可不等于行情再分发许可。没有安装存在许可表述冲突的 mootdx，也没有采购收费服务。

采集器只允许固定HTTPS东财日资金/涨停池端点，继承运行环境代理与TLS；每次请求12秒、2MiB，无无限重试。北交所92前缀不会分到上海。接收时间和原始行情时间分开，日资金原始发布时间未知时 sourceTimestamp=null。默认日期优先采用实际响应中的最近交易日，不把凌晨、周末查询日写成行情日。池比例仅在同日、完整、去重且不交叉时计算；炸板未封池不包含所有曾炸板又回封的股票。

2026-11-12 UTC真实只读探测：板块资金成功120行，封板37只、炸板未封35只。首次市场及个股资金503；复测默认查询日为北京时间11月13日，实际最近交易日为11月12日，市场资金及两池成功、个股资金仍503。可用性会变化，不能据此宣称持续实时接通。

## API与运行

以下API均要求编辑者权限，响应no-store：

- `POST /api/research/public-context`：可选 `{symbol,sectorCode,date,historyDays}`；显式联网并将来源报告封存至固定私有目录，不接受客户端URL或输出路径。
- `POST /api/research/linked-intelligence`：`{schemaVersion:1,asOf,tradeDates,stocks,linkage?,sectorHistory?,sectorCurrent?,publicContext?,persist?}`，最多20只/每只500根，JSON至多2MiB；计算在192MiB、15秒worker内进行。逐票保存状态单独报告，失败不假称成功。
- `GET /api/research/stock-memory?symbol=600001`：最多返回20个最近版本，读取验证整条链，展示冻结预测成熟后的Brier。

联动股票字段：`{symbol,name,source,priceBasis,observedAt,bars}`。bar至少为合法`{date,open,high,low,close,volume}`；要参与历史估计，还需当时可得的`knownAt,statusKnownAt,suspended:false,tradable:true,isST:false,corporateAction:false`，以及显式真实交易日历。涨停另需`noPriceLimit:false,limitUpPrice,limitReferencePrice,limitKnownAt`。上传原始旧数据时不准把今天接收时点改成历史当日可得时点。UI提供空模板，不含假行情。

```sh
# 从V6_BO执行；私有目录0700、文件0600，禁止public或符号链接路径。
npm run research:context:capture -- --output-dir /private/context --sector BK1034
npm run research:context:watch -- --output-dir /private/context --interval-seconds 900
```

watch逐次串行采集，失败/部分结果退避，默认连续5次停止，JSONL日志有大小上限，SIGTERM等待当前有界请求结束。只积累公开上下文，不伪造因子智能体所需的授权历史、原始信号或交易状态。环境变量`V6_PUBLIC_CONTEXT_DIR`控制公共来源档案目录，`V6_STOCK_INTELLIGENCE_DIR`控制逐票记忆目录；默认在服务端data独立子目录，不能提交运行态数据。

## 验证和实际限制

测试证据在最终PR/CI及交付报告中记录，不用本地通过代替远端检查。新增测试覆盖真实HTTP权限与封存、字段缺失/零值/口径、日期与来源、未来数据、重复预测、崩溃重启和多进程发布竞争、统计区间、源故障、采集退避及页面注入防护。Playwright使用夹具在320/390/1440 CSS像素验证交互、无溢出及脚本异常；不等于真实行情或真机原图验收。

本轮实测：Node22.23.5、ML Python3.11.18及仓库固定依赖，同环境后端全量 **2064通过/0失败/0跳过**，TAP完整性校验成功；网页构建及40项测试通过，dist字节一致；历史接收工具20项通过；完整服务隔离HTTP启动冒烟通过；新增OpenAI/ChatGPT运行时依赖禁入检查通过。ML11项原始失败的同环境根因/前后对照见 `PR174_CORRECTNESS_20261112.md`，本轮没有修改ML测试断言或跳过测试。

额外运行旧 `_test_prevsnap.js`：修改前版本39/40，G8仍只在主页内查已迁移到外部app.js的渲染代码。本轮仅补读实际加载的app.js，原G8条件及其余断言均保持，修复后40/40；没有修改锁定主页。该独立脚本不计入上面的2064项。

当前尚无足够事前冻结的新样本证明收益改善；资金接口不稳定、历史可得时点与公司行动证据不足时概率会未知。研究watch仅在运行它的机器存活期间工作，不表示指定WorkBuddy生产主机已部署。生产主机写入鉴权仍需实际接通，未发送真实通知、未改变真实账户。回滚用git revert本轮提交；已封存的私有档案独立保留，不删除用户历史。
