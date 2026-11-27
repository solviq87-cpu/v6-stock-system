# D组第三十五批：D23海外股票只读参考行情补缺（2026-11-27）

## 原任务和范围
#455原交接明确D23全球实时价格、权限及接通待验。本批复用#443原iTick REST股票适配器，扩展独立HK/US/JP的单次授权本地展示入口；不新增第二套采集中心或调度器，不修改策略、账户、发布或原60项主线。父#443精确HEAD a114ac796f34b86a6c8252662efc3c8470e58eae；原A股接口名称和返回合同保留。

## 本轮八项
1. 港股按供应商原始数字证券代码查询，拒绝不支持的格式；声明币种不冒充源端已核实的HKD等币种。
2. 美股按明确US和原始ticker查询，可指定由操作者核对过的exchange；请求交易所不等于响应确认交易所。
3. 日股支持明确JP的四位数字证券代码；非数字日本代码和更多市场不在本轮支持范围。海外结果独立模式，不能混入A股共识。
4. 每次必须显式声明region/code/currency/exchange授权本地展示范围，单独使用V6_ITICK_GLOBAL_TOKEN，不自动借用A股配置；无合法声明或凭据零派发。声明不等于独立授权证明。
5. 原共享HTTP传输限定200完整响应、拒绝跳转、不重试401/403/429、超时停止返回、错误不输出凭据或响应URL。
6. 原ts状态区分正常、停牌、退市、熔断；非正常和过时价格仅作参考，不得视为当前可交易。正常状态不证明已开市。
7. 海外请求起始、原始成交、完整字节接收和发布时点分别保留，实际完整接收后计算原始成交年龄；共享高水位拒绝无效、回拨和未来成交。15秒年龄门禁不是授权实时性证明。
8. 原共享传输增加有界64KiB字节流、严格UTF8、长度及明确JSON类型校验；海外严格流式响应，A股保留旧注入文本合同。错代码、显式市场/交易所/币种矛盾拒绝，不推断未知复权和数量单位，所有交易、通知、训练及实时认证标志均false。新增手动CLI及原生测试。

## 官方依据
实际查阅 iTick 官方股票单次报价文档 https://docs.itick.org/zh-cn/rest-api/stocks/stock-quote 及批量文档 https://docs.itick.org/zh-cn/rest-api/stocks/stock-quotes ，核对固定 /stock/quote 路径、region HK/US/JP、token、code、exchange区分、s/ld/p/t/ts字段和状态。文档示例不证明具体用户套餐、授权、市场覆盖、当前真实返回或独立交易所认证。官方限制未经许可二次分发，本批仅提供明确授权后的本地单次展示，不提供转发、自动订阅或存证新数据分发路径；真实接口可用性、凭据与服务条款由现场核实。

## 实际原生Node结果
Node.js v22.16.0实际执行新增8项及原未修改A股7项：15/15通过，0失败、0跳过、0取消（156.353171ms）。运行真实Node Response、Buffer、URL、计时器、AbortController与实际适配器，不进行网络访问；供应商回复均为受控夹具。node --check 两个JS入口通过。TAP SHA256 59a3743ea21d4e7a5674ab72dc298171732ed313a46353b1a526ed63c3b2151d。
精确文件：
- 原itick-stock-quote.js 8f80e5aa25123a8e4b33bc080e48c9b6ea9b4f59；修后 1cb0b89bb4909ab2d466fd3420239a355f214e35
- 原public-quote-redirect-policy.js 2c0f3656e26d22f49026dc1027f681230e0e2cef（未改，实际本地hash一致）
- 原itick-stock-quote.test.js 3e38660ef4db3d7f2cd57c56ac82d7898102afd3（未改，实际本地hash一致）
- 新scripts/global-stock-quote.js f26b4d610e7b7e0ec5a8210bfacfb0c9be462ccc
- 新tests/fayo-d-global-stock-reference.test.js 14e08e5b65dfa3940ef43aa58add083d1cfc77b4
远端源码及新增测试读回与本地实跑精确Git blob一致。原#443完整gateway集成测试、#436共识、#477公开诊断、所有其他跨组组合和全量CI未在本次执行，不冒充通过。

复跑：cd V6_BO && node --test tests/itick-stock-quote.test.js tests/fayo-d-global-stock-reference.test.js
只有已合法授权并实际设置本地V6_ITICK_GLOBAL_TOKEN后才可手动运行：node scripts/global-stock-quote.js HK 700 HKD --authorized-local-display
不把实际凭据放到聊天、源码或日志。未实际执行手动外部采集、未注册、未购买、未部署、未合并；不启动轮询、WebSocket、交易或通知。

## 原编号进度及剩余阻塞
D23已在历史62/78部分整改集合中，此轮是明确未完成能力的补缺，不重复累计。当前原编号局部整改62/78（79.49%）、待核对16/78、完整验收确认0/78。再次定向检索原D组正文未恢复；检出的其他D编号研究报告及原系统78项总账不是同一任务表，不强行映射。剩余 D05/D06/D07/D11/D46/D47/D50/D51/D52/D65/D67/D68/D69/D71/D72/D75 原标题及验收定义仍需原任务书恢复。真实海外授权、原始实际回包、完整市场/币种身份、海外交易日历、实时指数、下游消费及全量联合验收仍待。总管唯一合并与发布，原60项主线不改。
