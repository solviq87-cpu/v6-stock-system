# C组第十六批 A：双端回归阻塞修复（未发布）
基线 #464@0d50d4d048d0c5485b0e3c6b3198c04bd1c6bec5，依赖#462及#451；保留原提交。C-EX25/36/48/51/52及22.17–18，实际验收优先。原任务书完整内容已实读。原#462全量6136过1失败，#464全量6133过15失败（CI 45942027661、45942956806，失败日志job 140318258294、140321165815）。原eager module缺离线壳缓存依赖，以及缺文档事件API的原测试适配器抛TypeError。后者在旧terminal-workbench测试中连锁失败，不是14个独立功能缺陷。
C16.1 原SW公开壳加入已存在风险读取模块，原API/鉴权/令牌请求network-only不变，不缓存私有数据；正式统一版本由总管更新。
C16.2 文档缺事件API、未知可见性时不崩溃、不允许私有当前读取；真实可见事件恢复。
C16.3 dispose后不接受迟到可见性回调，保留原路由撤销。
C16.4 同账户同服务器生成时点保存已见最短有效期，窄报告删除风险行也不延长窗口；原15秒不放宽。
原Node v22.16.0 实测真实node:test/vm/EventTarget/Request/Response、合成cache/network/document适配器，非真实浏览器。原SW/helper/C11/C12测试按Git blob核对。修前7新测试1过6失败，修后7/7；原24专项一并回归31/31，0失败0跳过。新SW/helper/test与实际本地blob完全一致。combined.spec.log Git blob b751bba9c3291b7aae1f0116d279cc677aad9966，SHA256 76c608a59e8ffa744d562ada48794c81ffe7dcc773083c93648a71c3ab3a343f；修前本地日志blob 699e5e16726062af825c72c604a0c2af128bbca3，SHA256 79e2725e99b4993bd470ff847b441556477c8a33bbe66b883b58b2afecd6c794。复现：cd V6_BO && node --test --test-reporter=spec tests/c-risk-view-ci-integrity.test.js tests/c-risk-workbench-read-scope.test.js tests/c-risk-view-replay-and-actions.test.js。新增测试不删减原失败项，完整fayo-product-contract/terminal-workbench及全量尚待新CI。
不与#466成本修复混合，B补丁走#472链。旧失败及历史测试记录保留。未合dev、未发布、未改变账户、风控参数或真实通知。回滚仅撤本增量；总管统一构建版本和SW缓存号。
