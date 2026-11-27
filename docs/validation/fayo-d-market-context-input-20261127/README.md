# 绯曜 FAYO D组第八批｜市场上下文四项数据整改及 #439 回归收尾 · 2026-11-27

基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。本批五个小任务中第一项已独立追加至原 #439（新头 8703fabc91ee0f8083f33c80c744b89b94d5e4b7），其余四项在本分支。不是五个 D 大项完全验收。D12/D14/D16/D17、D08/D27/D31/D36/D38/D49/D62/D66/D77/D78 部分。D15 盘口独立接线及授权Level-2仍待总管协调，不能用竞价或资金代理数据冒充盘口或逐笔。

1. 原 #439 CI 6107/6108，失败是独立休市测试模拟回拨；原分支保留全部生产门禁、更新独立测试并添加真实回拨反例，隔离原生产代码七个断言符合预期。详见 https://github.com/solviq87-cpu/v6-stock-system/blob/8703fabc91ee0f8083f33c80c744b89b94d5e4b7/docs/validation/fayo-d-cross-check-cache-20261127/CI_FOLLOWUP.md 。
2. 原指数模块：异常/抛错时钟清除不可信视图但不降低已观察时钟高水位，保持单实例原供应商5秒请求预算；过期会话标签不再清除真实当日缓存。保留原来源冲突、epoch、原15秒新鲜度、只读指数、无交易/通知权限。不认证真实交易所时钟，不替代跨进程 governor。
3. 原竞价共振：严格实际日历日期及类型，核对北京时间当前日与全市场快照接收日，禁止标签所指时刻晚于原快照或当前时钟。原 phase 与时段校验保持，日期标签仍非原始供应商采集时间，不补 capturedAt/quoteAt，不认证9:25成交额。
4. 东财板块成员：明确沪深A股已支持前缀与 f13 相互矛盾时拒绝完整成员，空选择成员不作为完整清单；其他代码族保持原边界而非新交易所认证。保留原分页、原字节、原目录、历史成员不倒填。
5. 东财板块资金：有日期不等于有有效主力净额，报告增加实际返回窗口主力净额已知/缺失计数；零保持零，全部缺失 unknown，部分缺失 partial-evidence，原日期、组件及接收时点保留。超出±100%的比例字段标未知，不修改原响应。该覆盖仅为返回日期内主力净额字段，非交易日完整性/原始上游真实性/资金口径认证。

## 精确验证
原文件 blob：ad513b09af98c11d9eb8b2d033f3ceec0d5bc6af / d509fd4aa0496ad0f8366535ed1a47c46a8645d6 / 2af89f50e86f4270d5004f76ce3f9bf96919e107。实际用隔离 V8 执行精确源代码和原指数、竞价测试（10项），新增9项同步/异步测试。原 quote-observation-view、market-snapshot-quote-time 实际加载；板块采集器注入模拟 requestJson 及 URL/Buffer/crypto摘要/计时器/请求包装夹具，未真实联网或验证文件哈希、原生 HTTP/限流调度。正式测试使用 node:test；不是 Node 全量。
修前 10/19 通过；修后 19/19 通过。新增测试修前失败清单：
- index clock rollback remains blocked until original high water, including repeated reads: equal: expected 1 got 2
- throwing clock clears the index observation, keeps cooldown and recovers normally: clock
- old session labels do not evict an already valid current-day index cache: Cannot read properties of undefined (reading 'quoteAt')
- auction date labels must be valid dates and match actual current and receipt dates: equal: expected false got true
- future auction phase or a phase later than the stock snapshot cannot enter evidence: equal: expected false got true
- explicit Shanghai and Shenzhen member market contradictions prevent complete membership: equal: expected false got true
- an empty selected-board member page is not complete membership: equal: expected false got true
- dated missing main funds remain unknown and true zero is not a missing value: equal: expected "unknown" got "observed-unverified"
- partial funds coverage preserves original dates and masks implausible ratio fields: equal: expected "partial-evidence" got "observed-unverified"
原测试均保留。完整 git ls-remote 仍受运行环境 DNS 限制；待精确头运行原 node:test、东财板块采集原测试、真实请求预算、档案与下游联动、全量和双端。未取得数据权限、未消耗供应商额度、未购买或启用任何接口。

## 交接
已查 #427 两页、#430/#446/#448/#407/#419/#418/#439/#445 相关路径，本批目标生产文件未见重叠。其他开放/历史 PR 完整冲突扫描待总管。保留此前各 PR 及原证据；#439 旧失败和新头待验分别记录。未合并、发布、部署、改共享总表；唯一发布入口、原账本、策略及授权不变。回退仅撤销隔离补丁，不覆盖历史原始数据。
