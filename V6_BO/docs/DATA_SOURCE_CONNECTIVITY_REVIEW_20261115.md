# FAYO 数据调用、5秒读取与完整每日复盘

本批基线：`dev@6e60b829e9e2fe1e5a7976456a83df2385601de7`。分支：`feat/data-source-connectivity-20261115`。

## 实现及边界

- 登录且可见的页面每5秒读取同源共享 `/api/state`。慢请求保持单飞，隐藏暂停，恢复可见立即读取，退出/鉴权失效停止。当前接口没有向前端提供可独立核验的完整交易日日历，因此休市也读取快照；这不是每5秒重新向供应商抓取全A，也不改变原价时间。
- 首页新增“每日复盘 · 全部涨停票”，市场中的“每日复盘”有独立完整清单。搜索、所有板块标签筛选、25条分页和原股票研究抽屉保留；旧复盘/历史学习继续可达。
- 策略池与只读复盘池分开：`ztReviewPool` 保存取得的供应商记录及策略排除标志；`ztReviewPoolMeta` 保存源日期、总量/返回量/去重、交集/独有、缺原因和部分状态。展示供应商可见范围，不声称交易所全部证券已认证。
- 新增固定财联社只读池适配器，与东财逐代码/同日合并；完整保留ST、涨停原因、原始事件时间、多个板块标签。CLS事件时间不充当价格时间，涨跌幅单位未核验时保持未知。
- 每条原因需要自身来源与交易日；请求日期不充当源日期。跨日原因、旧角色不拼接到新一天；同日源失败保留原证据/原时点并标本次未确认，部分回包也不丢本轮有效新票。
- 修复腾讯指数代码协议、竞价顶层昨收字段/日期/零价、`board+max`盘中池缓存串用、涨停证据映射丢失。计算失败/未就绪/计算中与真实零命中分别展示。
- 冷启动只读池独立恢复，即使策略快照为空也保留完整来源记录；全部标为本次启动尚未核验，不把恢复过程写成一次供应商失败。
- 原生入口采用`20261115data1`资源版本；旧页面字节、旧APP_VER及其原断言保持不变，SW保持网络优先并预缓存新原生入口。
- 代理环境下复用既有受限curl传输，修复原Node路径未消费标准代理配置的问题；同一供应商共享预约/403/429冷却，禁止curlrc额外重试/跳转，不输出代理值。非代理环境保留原Node传输。
- 新闻时间线接入已通过原权限投影、来源及原发布时间核验的巨潮公告。缺凭据/未安装SDK/未配置研究文件的路线仍明确未就绪，不自动变成已接通。

原账户、四套策略阈值、下单/15秒门禁、通知配置和唯一发布者保持原职责。新复盘记录全部 `canTrade:false` / `canNotify:false`。

## 实网证据（单次、只读研究）

核验时点：2026-11-15；行情归属最近交易日2026-11-13，未伪装周日实时价。

| 链路 | 本环境实际结果 |
| --- | --- |
| 应用指数适配器 | 修前0条；代理传输修复后4条，全部保留11月13日原时点 |
| 腾讯逐股展示适配器 | 600519/000001两条带原始日期的历史报价；0条可交易；交易用途快照拒绝旧价属于原门禁 |
| 东财涨停池 | 源日期11月13日，声明/返回37条 |
| 财联社涨停池 | 源日期11月13日，声明/返回38条，38条原因及板块、1条ST |
| 两源→归一化→复盘投影 | 去重38条，原因38条，前端投影38条，0条交易/通知权限；253个供应商板块/概念标签不等于253个行业 |
| 竞价分钟 | 实际取得11条11月13日记录；历史记录不认证下一交易日竞价 |
| 行业资金 | 本轮调用HTTP 502，不能认定接通；保留缺失/旧有效证据，不用0代替 |

数据来源：[东财涨停池说明](https://quote.eastmoney.com/ztb/detail#type=ztgc)、[财联社公开涨停池](https://x-quote.cls.cn/quote/index/up_down_analysis?app=CailianpressWeb&os=web&sv=8.4.6&type=up_pool&way=last_px&rever=1)。两个源覆盖口径不同；同源SDK不计作独立供应商。

## 验证与复现

- 不可变基线同环境：4078项，4077通过、0失败、1项真实PowerShell包装器因Linux平台条件跳过。使用已有scikit-learn 1.8环境，没有修改测试断言掩盖ML失败。
- 最终冻结代码完整回归：4176项，4175通过、0失败、同一PowerShell平台条件跳过1项；耗时183.8秒，使用上述同一ML解释器。执行期间32个代码文件SHA-256未变化。精确提交CI结果在PR/交付回执核对，不能把本地通过当作GitHub或生产通过。
- `V6_WEB npm run build`成功；原网页研究40项通过，单文件静态构建/隔离执行9项通过。
- 已跑纯协议、五秒单飞/暂停/撤权、完整复盘、日期/缺数/部分回包/来源失败专项；新增边界先执行复现失败再修复。旧静态`_test_stamp_day`/`_test_pool_sync`各1项在基线同样失败，未放宽这些断言。
- 已跑原生浏览器跨390/1366宽度的4组场景，以及独立97条完整复盘浏览器验证：分页全部可达、搜索/板块筛选/股票回调、展开内容保留、垂直可滑动、无横向溢出；合成夹具禁止外网，不冒充生产截图。

```bash
cd V6_BO
V6_MODEL_PYTHON=/path/to/existing-ml-venv/bin/python3 npm test
node scripts/check-fayo.js
node --test tests/index-auction-protocol.test.js tests/backend-pool-source-evidence.test.js \
  tests/limit-review-pool.test.js tests/limit-review-boot.test.js tests/limit-reason-evidence.test.js tests/cls-limit-up-pool.test.js \
  tests/fayo-daily-review.test.js tests/fayo-data-consumption.test.js tests/fayo-polling.test.js \
  tests/market-proxy-transport.test.js tests/research-context-request-budget.test.js
node scripts/fayo-daily-review-browser-check.js
```

## 上线与未验证事项

- 用户给定FAYO站点的根HTML及`/nova/market.js`已通过受保护只读读取确认属于原生Nova；读取未接触实际账户状态，访问码未写入Git/文件/输出。线上market.js仍是修前版本。本批代码/浏览器合成测试不证明FAYO新功能已上线。
- Sites当前连接没有可管理的该站点。既有固定managed-task仍只负责`af3c7822e6aafc135.app.workbuddy.host`的单文件静态HTML；未改目标、角色或并发新建发布者。新FAYO原生模块和Node后台需要其既有正式更新渠道的发布回执，不能用旧站点的绿色回执代替。
- 120条来源登记中，凭据/专用客户端/授权网关及尚未实现的路线没有被虚报为全部接通。资金502、真实交易时段5秒原价持续性、所有供应商稳定性、用户本机Windows与手机端、完整生产账户回归未在本批认证。
- 回滚只revert本批代码提交；不覆盖用户账户、历史或私有配置，不清空发布journal，不用旧ZIP覆盖新工程。
