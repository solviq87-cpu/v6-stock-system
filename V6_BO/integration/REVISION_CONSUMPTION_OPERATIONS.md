# 研究参数消费修订保护 20261106ax

新增可选CLI参数，旧两参数及 --registry 用法兼容：

```bash
node scripts/adaptive-research.js /safe/future.json /safe/new-report.json --registry /safe/experiment --expected-revision 4
```

先用learning-profile status核对当前修订；任务显式携带核对的修订。注册器在同一内核锁内读取、核对修订和复算证据，然后返回参数快照。修订过期/非正安全整数、重复/未知参数或缺少registry均拒绝，拒绝不会创建报告或修改状态。不自动读取新修订重试。输出parameterProfile记录实际registryRevision与参数指纹。

保护的是参数快照读取时的修订：之后注册器改变不会取消已经开始的研究，也不声称结果发布时仍是最新激活值。需要该语义的未来后台集成还须在提交结果时重新核对。未接HTTP、未建立自动后台消费；未来需固定服务端目录/鉴权，不接受请求体任意文件路径。未连接账户或券商，不改变策略/学习计算规则，双端仅缓存版本同步。

API createRegistry(root).activeProfile(expectedRevision) 和 applyActiveProfile(input,root,expectedRevision) 新增可选数值参数，省略沿用旧行为。供应商自动输入及真实数据等六类现场验收仍待；见aw交接及原验收台账。
