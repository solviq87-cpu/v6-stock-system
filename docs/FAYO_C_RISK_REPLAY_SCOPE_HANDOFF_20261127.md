# FAYO C组第十二批：风险读取重放、后台恢复与提醒操作隔离（未发布）

依赖#462精确HEAD 80b5efe5f90df89e0ea2282c93f693f9e3ee2567，#462依赖#451，保持原始dev 0c45291d7156be8a1206f0bb272f3c719d5d2336。只改原共享view、既有辅助模块、原browser检查及新增专项，不修改账户、行情、原权限、通知网关、生产阈值。总管按#451→#462→本增量顺序组合，不直接合并dev。已阅读原C组任务书22.17/18、EX25/36/47/48/51/52；核对原客户端cache:no-store、SW对API network-only、原提醒生命周期的accountId/accountEpoch/revision/ledgerOwned/canTrade真实字段，保留这些门禁。重复报告只记当前组件的两个账户时间，不缓存私人报告，不冒充跨进程真实性认证。

## 五个小任务
- C12.1（22.17/EX48）：同服务器生成时点的回包不重置有效期，换股也不重置该账户该生成时点。较旧服务器生成时点、局部单调时间回退拒绝；首份响应已经超期不得再复活。每个组件只记录两个账户时钟；页面重建仍依赖原服务的no-store与原时点核验。
- C12.2（EX25/48）：明确的dataAt:null不再降级为包装sourceAt；旧报告只能消耗原剩余有效期，不能重新获得15秒。旧证据不可知时保守清理当前投影，不删除后台历史。
- C12.3（22.17/EX48）：接原页面watchConnectivity的真实document.visibilitychange；进入后台清除并停止读取，重新可见时原接口读取，恢复时仍校验重放。不是新轮询机制。
- C12.4（22.13/17/EX36/47/51）：提醒档案单独核对同账户/epoch、有效revision（允许原空档revision=0）、唯一根因及原只读边界。错配的提醒子档案不展示；原核心风险报告保留；查看/静音控件禁用。只构造原允许的view、mute操作，不伪造送达。
- C12.5（EX48/51）：查看、根因静音与类别静音共享一个在途操作令牌，重复点击不叠发；旧完成不解锁新令牌、不刷新其他账户。已发出的合法POST仍由原后端权限/epoch/revision裁决，不承诺取消服务器操作。

## 实际验证与限制
Node v22.16.0，隔离目录使用#462原辅助模块和原13项测试（blob b9ec2c732a8dc9f62bdf56074b92d3af1883c73b / 90c453e02a48eb0ae0810548a3072bc82ff8f700，均核对）。修改后的辅助模块 blob 82024ef294dbd3e3622c3d82f1e4269b3744b389；新测试 blob 0be095c3ae4aeebf77614cb800a1a7878cf14bee，与本地实际测试代码完全一致。原生11项新增+原13项回归=24通过0失败0跳过；复跑spec日志 blob 1800dd8c26ee7942a905950896e348ae71d1db0d / SHA256 570860eff93ffbd76b04db8ed37be17a6b45c99753f10ecbedbe912b68b9d1e8，见 validation/fayo-c-risk-replay-scope-20261127/node.spec.log。命令：cd V6_BO && node --test --test-reporter=spec tests/c-risk-workbench-read-scope.test.js tests/c-risk-view-replay-and-actions.test.js。
本地真实Chromium 144.0.7559.96，1280x800、390x844，各9项辅助模块+真实DOM测试，共18/18通过。使用内存测试文档、原ES模块原样加仅测试引用、合成报告、显式模拟visibilitychange事件及真实DOM点击；本地HTTP页面被环境策略阻止，完整私有仓库clone仍DNS失败。不是原工作台完整浏览器、手机实机、真实服务或行情。实测结果 blob 4473910f9e28bc816a4f12583ee4dfa5e9cd1198 / SHA256 f9df9b063b60c77c528c591d0b8f2742d482d6751042c71743888ec5aae4e6c1，见 validation/fayo-c-risk-replay-scope-20261127/chromium-helper.json。新增/修改的原共享view与原browser脚本V8语法解析通过，尚未实际执行其完整依赖；原browser脚本增设7项每viewport的原页面断言，待CI，不计通过。隔离辅助测试不是完整权限验收。

## 交接
原18项均有部分开发/原型，完整验收仍0/18；原52项EX保留。本批不增加主任务完成数；累计新增专项168+11=179（各批不同隔离范围，13回归及18浏览器检查不重复计入）。开工读取前七批#429/#432/#434/#438/#442/#445/#446主CI和UI均成功，提交覆盖仍失败或重跑排队；本批及前置#451/#462尚须实际精确HEAD回执。共享riskAssessment审批、正式A/B/D联动、真实数据、逐证券实际退出/成本、组合回归、现场及授权通知/部署均未验收。回滚撤本后续增量；未合并、未部署、未发真实通知、未下单。
