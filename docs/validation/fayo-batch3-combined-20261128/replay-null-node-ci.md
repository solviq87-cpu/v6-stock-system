# 组合验收回归：原回放空节点修复

父提交 894dff6964f102b700b754a47f211fb4a9d587f3。真实 #601 CI 46110768742 / verify job 140873569920，8057项中8056通过、1失败；失败为 fayo-evidence-continuation-client.test.mjs 的 returning to a replay...，Cannot read properties of null (reading 'children')。原可选 attentionPair 直接把 null 传给 replaceChildren，在浏览器会产生多余的文本节点，在原DOM测试夹具中导致树遍历失败。改成条件数组展开，不修改原回放授权、身份校验、存证或现有测试断言。补有可选数据→重新读取缺失数据用例。

实测原5份实际UI/研究源码及原测试（隔离V8，ESM装载、DOM原测试夹具、URL/AbortController/断言/异步调度适配）：修前 10/11，同一个失败；修后 12/12，全部通过，原用例保留。非Node原生全仓、非真实浏览器。原正式全量与双端仍须当前SHA通过。没有扩大功能范围、改交易权限或部署。
