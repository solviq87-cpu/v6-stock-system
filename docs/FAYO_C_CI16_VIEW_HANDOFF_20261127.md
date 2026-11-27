# C组第十六批 A：实际CI失败与前端风险读取边界修复（未发布）

重开原C任务书，优先22.17/18、EX25/48/51/52的实际回归，不按开工预设继续开发新原型。唯一原始dev 0c45291d7156be8a1206f0bb272f3c719d5d2336；依赖#464精确HEAD 0d50d4d048d0c5485b0e3c6b3198c04bd1c6bec5（#451→#462→#464）。原旧HEAD及失败日志保留。总管最终统一版本与SW缓存号。

实际GitHub失败：#462 verify job 140318258294，6136通过1失败；#464 verify job 140321165815，6133通过15失败，均0跳过。#462/#464同一离线壳缺依赖；#464另外14个旧terminal-workbench测试因document.addEventListener缺失抛错。浏览器几何通过并不抵销这些失败。原测试不删不改。

C16.1 在原SW PRECACHE增加唯一新增公共JS，保持原私密API、Authorization、token查询的network-only/no-store，未缓存私人账户。C16.2 文档事件接口缺失/注册失败、未知可见性均不可读当前私人风险，同时不抛异常阻塞父页面。C16.3 dispose幂等，已释放回调即使迟到也不得复活读取。C16.4 相同账户和服务器生成时点记录已见最短到期时钟；更窄的个股报告或丢失原过期字段不能延长，明确未知时钟不能通过同代遗漏恢复；新代仍依原时点检查。全部只读，不放宽原门禁。

本地真实Node v22.16.0，完整原SW、helper及原C11/C12测试文件Git blob与远端一致。使用node:test、vm、EventTarget、Request/Response，缓存、网络和简化文档为合成测试adapter（不是实机）。新增7项修前1通过6失败、修后7通过0失败；原13+11项不改复跑全过，共31/31、0跳过。修前日志SHA256 79e2725e99b4993bd470ff847b441556477c8a33bbe66b883b58b2afecd6c794；修后7项SHA256 d3a630de31bb3eb8e4013b28aea522e3a86dd669c6bc2a2df1883c316ecd4da5；合计实际日志见 validation/fayo-c-ci16-view-20261127/combined.spec.log，SHA256 76c608a59e8ffa744d562ada48794c81ffe7dcc773083c93648a71c3ab3a343f。四份新增/修改源码与日志blob与本地核对一致。命令 cd V6_BO && node --test --test-reporter=spec tests/c-risk-view-ci-integrity.test.js tests/c-risk-workbench-read-scope.test.js tests/c-risk-view-replay-and-actions.test.js。原完整图和14个旧主页测试仍由全仓CI实际验证；本地git DNS仍失败。此前#432/#434/#438重试仍排队；不虚构绿色。未合并、部署、交易或外发通知。
