# D组第二十五批：原生 Node 主备恢复与跨进程限流验收（2026-11-27）

## 范围与准确基线
沿用 #509 原精确 HEAD 8f68459a007bf4f1efa5ce9d063548fbbf0a762b（接续 #495），不新建重复分支。仅在本PR追加五项真实独立 Node 子进程测试及本验收记录，不修改生产源码、其他组、CI保护或权限。新测试提交 e88288088fed4720808ce6e40090e081f4b188de。

## 本地实际原生测试
Node.js v22.16.0，真实文件系统、SHA-256、权限、独占锁及子进程，供应商任务/时间/历史导入器为受控测试夹具。未联网。
- 原 market-request-governor.test.js 27项 + 修订 phase4-market-queue-clock.test.js 6项：33/33。
- 加入原 phase4-market-failover-recovery.test.js 5项及 #495 新增 fayo-d-failover-recovery-integrity.test.js 14项：52/52。
- 再加入新增 fayo-d-governor-process-recovery.test.js 5项：**57/57通过，0失败、0跳过、0取消**。本次完整专项 TAP 记录实际运行，约0.71秒（本地受控夹具环境）。不是把前几轮相同测试累加成独立测试数。

新增五项：HTTP429与403的持久冷却期各经独立Node进程重启且不提前发送；异常退出保留独占锁后的拒绝；已运行实例读取另一进程持久的限制；另一进程破坏状态文件后，既有在途任务的结果失败关闭且后续源不能继续。异常退出场景为有意留下锁的子进程退出，不声称实际断电或跨机器集群压测。

精确Git blob（本地git hash-object和远端相符）：
- market-request-governor.js d151fb42a44074ad6bd29cf4fea3bb17a34770e9
- market-failover.js f98964c76de17d62d50e1f6853b0ca09d4bacdf4
- market-request-governor.test.js 6a51487535c75bd2d122950f7007b4331cccb0cb
- phase4-market-queue-clock.test.js ccefc5f8e4188c1ef5adc054ed1a9d7f4f2b6d58
- phase4-market-failover-recovery.test.js 23b3ffac8c02c40515e50e1f3a2f84c835657d34
- fayo-d-failover-recovery-integrity.test.js 1278068c1ad93dc9a245142109b868967d9cd61d
- fayo-d-governor-process-recovery.test.js de20519ee0fbbc8155d8289eb74f785c837a84e1

复跑：
`cd V6_BO && node --test tests/market-request-governor.test.js tests/phase4-market-queue-clock.test.js tests/fayo-d-failover-recovery-integrity.test.js tests/phase4-market-failover-recovery.test.js tests/fayo-d-governor-process-recovery.test.js`
本地执行另通过环境变量 V6_MARKET_REQUEST_STATE_DIR 指向隔离测试目录，避免读取用户实际运行状态；各子进程仅使用独立临时目录。原两份生产模块、新增测试通过 node --check。主备测试的历史导入器仍使用既有注入桩，未完成真实存证链跨进程原子事务和实际供应商取数认证。

## 最新远端CI及总任务进度
#497 HEAD 3d58fb7f987c532aaf989897023c0172fd9adb98，V6 CI run 45956768135 / verify job 140364942123：6558/6565通过、7失败、0跳过、0取消。失败与#427原候选的6项条件单HTTP及1项交易计划HTTP相同；没有新增D组跨日恢复测试失败。a-share-session-data-quality与multi-source-data-lineage job成功。UI Browser Geometry及Commit Coverage失败。#503/#507/#509本轮查询时尚排队。原D23、D24记录保留；不宣称远端全量已通过或七项跨组问题已修复。

前22批CI快照更新：16批成功、5批失败、1批（#503）排队；其余原精确头状态沿用此前已核对的结果。原D01–D78任务书再检索仍未恢复完整编号定义，保持60/78有部分整改证据、18/78待核对继续、0/78完整验收已确认。76.92%仅为保守整改覆盖率。本轮实际补足原生文件与真实子进程验证，不重复累计原编号。未合并部署、购买服务或更改真实交易权限。全部组合CI与合法行情长期观察仍待总管协调。
