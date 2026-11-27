# D组第二十四批：真实 CI 回归定位及在途结果安全验收（2026-11-27）

## 分工与精确基线
接续 #495 精确 HEAD 6ad3614429e69c41a999f026c2ba44b6f1a45053，独立测试增量，不改 #495 原提交头、总管集成分支或其他组文件。仅修正一条旧队列测试的契约与验证证据，不修改生产代码，不删除原测试。上一批 #507 的组合测试和两处 HTTP 200 夹具修复独立保留，需按各自前置组合。

## 远端真实全量测试结果
对照总管 #427 原精确 HEAD 6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f：6546/6553，7失败。
- #493 精确 HEAD 1db724a106ee87248c3b5cdc1ba71e6bff32ff10，V6 CI run 45953307094 / verify job 140353926085：6564/6571通过、7失败、0跳过、0取消。七项失败与 #427 相同（paper-conditional-http.test.js 六项、paper-decision-plan-http.test.js 一项），未发现本批盘口新增测试失败。独立 a-share-session-data-quality 和 multi-source-data-lineage job 成功。UI Browser Geometry 与 Commit Coverage 仍失败。
- #495 精确 HEAD 6ad3614429e69c41a999f026c2ba44b6f1a45053，V6 CI run 45953910523 / verify job 140355843944：6559/6567通过、8失败、0跳过、0取消。除上述七项，新增 phase4-market-queue-clock.test.js:37 失败，日志 MARKET_RESTRICTED / Market request state unavailable。数据质量与多源血缘 job 成功。UI Browser Geometry 与 Commit Coverage 仍失败。

## 本次修复及实际测试
旧测试要求时钟回拨后，已经物理开始的任务直接向调用方返回成功，与 #495 的新失败关闭门禁冲突。新测试保留原队列被拒绝、未开始的任务不能发出、在途物理任务不提前取消、无残余计时器等检查，并明确：
- 故障发生时，在途任务仍处于 active，结果 Promise 未提前结束，物理操作只执行一次。
- 即使时钟随后恢复，旧任务物理完成的结果也不能对调用方报告成功，须返回 MARKET_RESTRICTED 且 stateUnavailable=true。
- 完成后释放 active 槽位；其他供应商的新请求仍被原失效状态拦截。
这里验证的是结果发布门禁，不承诺取消已发生网络 I/O 或撤销外部副作用。

实际 V8 隔离对照，加载精确 GitHub governor 生产源码、6项原 phase4 队列测试、原 market-request-governor.test.js 中 privateFixture 之前的13项内存测试及 #495 的2项在途时钟专项：
- #495生产源码 + 未修正的原队列测试：20/21通过、1失败，与真实CI新增失败一致。
- 同一生产源码 + 修正后的原队列测试：21/21通过、0失败。
- #427旧生产源码 + 原phase4六项：6/6通过。
- #427旧生产源码 + 更新后的phase4六项：5/6通过，预期失败（旧实现错误地返回原任务成功值）。因此不是删除断言或放宽安全门禁。
隔离执行使用真实生产模块与测试函数，注入断言、URL、计时器环境及不存在持久状态文件的夹具；未执行原生Node持久文件专项、完整原测试文件的磁盘用例、全量CI或真实行情。实际远端 CI 的原失败日志保留，不声称新提交已转绿。

精确文件身份：
- #427 governor 228aba3c9dd469003896ed39540dd75c59689627
- #495 governor d151fb42a44074ad6bd29cf4fea3bb17a34770e9（本增量不改）
- 原 phase4-market-queue-clock.test.js eeeca69b96196bf68a8e086101581153048d543c
- 修后 phase4-market-queue-clock.test.js ccefc5f8e4188c1ef5adc054ed1a9d7f4f2b6d58（远端读回相符）
- 复跑命令：cd V6_BO && node --test tests/phase4-market-queue-clock.test.js tests/market-request-governor.test.js tests/fayo-d-failover-recovery-integrity.test.js tests/phase4-market-failover-recovery.test.js
该命令包含本地尚未实际执行的Node磁盘和主备专项，供总管组合验证。

## 进度及剩余阻塞
前22批原精确头截至本轮复核：16批CI成功，4批CI失败（#473/#475 原旧HTTP夹具，#493/#495 集成候选继承的七项及#495本次定位的一项），2批CI尚排队（#497/#503）。这是沿用上一批其余18个头的已完成快照，并刷新最近四个头；并非所有分支全量联合测试。
#507 精确 HEAD a6b88c90394229bedfe2c81e67e3a267bb7b7d88 三项远端工作流排队；47/47原生资金/日历组合测试证据继续保留。#497/#503 工作流尚无完整结论。此前18批及新增#493/#495 Commit Coverage 失败，不能伪造smoke状态。
再次检索原任务书，仍未取得 D01–D78 原文及缺失标题。保留60/78项有部分整改证据、18/78待核对及继续、0/78完整验收已确认；76.92%为保守覆盖率。
未合并、部署、真实联网取数、购买或启用服务；不改账户、策略、原15秒时效、真实交易权限、CI配置或分支保护。七项跨组HTTP失败、UI几何与提交覆盖及全量组合、真实供应商与长期观察继续由总管协调。
