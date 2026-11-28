# 优化任务5｜F03.3 市场扩散速度

固定父提交 11e53a07a7fbd89e57dc023664d05ee78fd70cb3（#562），#563 总管组合独立保留。本轮只深化原F03.3，不扩大228项分母；未修改原广度、集中度、行情采集、策略、账户、风控或共享工作流。保留 F03.3 原静态上涨占比、中位数和等权均值。原 researchLiveMarket 输出新增 marketExpansion，原双端共用 research.js 读取直接及嵌套研究结果。

## 口径与限制
- 两个已经存在的同源、同交易日期、同连续交易时间窗、相同有效证券身份、同覆盖阈值的截面，采样完成时间间隔30—300秒，采样窗口不能重叠，原报价均需推进且在原90秒研究窗内。最低80%供应商市场总数覆盖；非交易所认证覆盖，时段为原工作日时钟提示，不认证假日。上限15000条。
- 按两次合格样本的上涨股占比差（百分点）及采样完成时间差折算每分钟变化，附转入上涨/退出上涨、两端占比、时点及分母。状态未知或不适用时指标为null，不补零。实际用户研究请求才消费，不追加任何API请求、不改变原调度。仅默认原行情生产读取使用进程内基线；注入/回放读取默认独立。重启、样本变化、较长间隔均重新积累，不承诺自动实时监控、交易或通知。
- 交易和通知始终false；无策略权重/排行变更。F05.5历史拥挤分位、F03.6异动持续状态另待，不用本轮扩散指标冒充完成。

## 实测回执
Node v22.16.0。新增12项核心（原报价时钟模块blob 3cd7f7e1f223413199087c860d39f512f06d5610），2项双端共用展示投影，合计14/14，0失败0跳过0取消。新增2项研究入口联动测试，固定原live-market-research及原breadth、calendar、quote-time，以未执行实网、无候选、无独立评分、无板块研究的五个依赖适配隔离：修前0/2（缺marketExpansion），修后2/2。另重跑前批指数异动9/9。新增核心、原研究入口及展示投影语法检查通过。未运行真实全依赖研究入口、完整浏览器、全仓CI、组合回归、真实盘中或设备验收。

实测文件 Git blob：
- recent-market-expansion.js 8390fa883682488b7a806b9bc82010ea079f228f
- recent-market-expansion.test.js 98649e812078e487dc8e10b8c358f1fb670a8f59
- live-market-research.js b67846c803559d87930f8eb7e12de7146a18d654
- market-expansion-view.mjs e7b692a03720851d7f5444cf34fc73b54e5793a1
- recent-market-expansion-view.test.js 012293935127600cdb97f61eb0396e6b27d2fcdc
- recent-market-expansion-integration.test.js 6a7329c9b4326a38f3a873944298a18707221a98

复验（V6_BO目录）：node --test tests/recent-market-expansion{,-view,-integration}.test.js；正式全依赖CI、浏览器和双端现场另签。旧#562 CI不能替代本新提交。不合并、不发布、不增加外部API或交易权限。
