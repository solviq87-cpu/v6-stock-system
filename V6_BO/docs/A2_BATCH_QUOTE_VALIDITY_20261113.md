# A2：报价批次最终时钟与部分失败保留

开发基线：`60a74c64c06b462cd026a2f91a649f3ac9e56ebd`（#177／#178已合并）。A1 PR #179尚未合并，本批直接从dev创建独立分支；不把未审查的A1合入dev，也不覆盖其分支。A1与A2均触及em.js的不同函数区域，组合兼容在隔离副本另验。

## 问题与最终行为

原腾讯每60只串行取数，报价刚收到时计算的freshness可能在等待后批时过期；主包装只看旧标签。另后批异常会抛掉前批已成功的行。当前修复保留数组接口及原源优先级：

1. `fetchBatchSnapshot`在最终返回前，对全批使用同一个时钟重验。每行须有正有限价格、非空来源、有效原始quoteAt及receivedAt，满足`quoteAt ≤ receivedAt ≤ publishedNow`、原报价年龄不超过15000ms、同一北京时间日期。15000允许，15001拒绝；曾在收到时属于未来的报价不能因后来等待而变有效。价格和时间不能跨行拼接。
2. 原始quoteAt、receivedAt不改写。原`canTrade:false`保留，研究备份即使新鲜也不会升级交易权限。失效行不靠标签或接收时间刷新进入实时结果。
3. 每次转备用前清除已失效首源。若首轮腾讯等待造成原本有效的东财票过期，只对尚未请求过腾讯的新缺口追补一次；每码每源最多一次，无无限重试。最终仍失效的行删除，不为维持覆盖率返回旧执行价。
4. `fetchBatchSnapshotTx`每60批独立失败隔离；某批失败后继续剩余批，保留其他成功行。全部请求失败仍抛错；HTTP成功但空／无效解析可以返回空数组，不能称为有效行情。沿用限频诊断，记录来源、最多60个请求代码及固定错误分类，不打印原始错误体／URL，不添加数组隐藏元数据。
5. 腾讯直接接口也被全A历史展示使用，所以仍返回带原始时点的旧／未知行，在最终时钟重新标stale／unknown／future并使canTrade=false。实时包装才过滤掉这些行，避免误删盘后展示。
6. 腾讯输入先去重，响应按请求代码挑完整的一行：fresh优先于合法旧行，旧行优先于未知／未来；同级取更新原时点，保持请求顺序。不把重复响应当成两只股票，不拆价格、昨收、时间等字段混合。

最终发布时间校验只保证返回瞬间的口径；下游使用时仍需重验。现有自动模拟执行的原时点门禁保持不变。

## 消费链与本批边界

主实时包装由server的板块联动、tick、涨停复盘资金补充，以及holdings锁仓／报价辅助调用。腾讯直接生产调用是`fetchAllStocksTx`。本批没有重写这些消费者、资金、概率、账户或UI。

`holdings`后续THS／S.stocks兜底、研究备份的canNotify、全A首源与指数原时点仍是独立问题；本批不能认证持仓／提醒全链。供应商许可、真实盘中稳定性、时点真实性和生产环境未现场验证。严格门禁和有界追补可能减少慢批次有效覆盖，但不会用旧报价补足覆盖率。

## 修改文件

| 文件 | 变化 |
|---|---|
| `em.js` | 最终发布校验、有限备用恢复、腾讯逐批故障隔离与去重 |
| `tests/batch-quote-publication.test.js` | 新22项完整模块VM行为测试，控制时钟并禁止网络／子进程／定时器 |
| `tests/quote-freshness-bj.test.js` | 旧备用fixture补齐同行原时点／接收时点／价格／来源 |
| `tests/six-photo-backups.test.js` | 旧研究备用fixture补完整证据，增加返回false断言 |
| `tests/learn-pruning-reference.test.js` | 抽取腾讯函数时同时加载其新私有校验helper，保留原断言 |
| 本文 | 范围、验证和回滚 |

无产品文件删除；两张锁定主页和原四策略、行情生产端点、账户协议不改。没有增加外部依赖或新的任意URL入口。

## 本次验证

```sh
cd V6_BO
node --test tests/batch-quote-publication.test.js tests/quote-freshness-bj.test.js tests/six-photo-backups.test.js tests/learn-pruning-reference.test.js tests/paper-original-quote-time.test.js tests/paper-authority-quote-time.test.js tests/em-funds-unknown.test.js
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node tests/full-server-isolated-smoke.js
```

专项60通过／0失败／0跳过；独立复核的重叠47项通过。新22项在精确基线源码上3通过／19失败，修复后全通过；首次harness路径解析错误另存，不计作产品缺陷。覆盖61／121／220只、首／中／后批失败、最终时钟、15秒边界、跨日／未来／未知、研究false、输入不变、有限追补与腾讯整行去重。原fixture修改没有删掉旧语义断言。

全量、独立干净克隆、A1组合、Web／静态／启动和精确远端候选CI结果在交付记录及PR中分别列出；没有运行或尚未完成的项目不得当通过。日志按实际runner计数，重叠专项不累加。

本地使用Node24.22.1、原生Python3.13.5、模型Python3.12.14与仓库固定ML依赖；远端CI使用其固定环境，结果分开披露。全部为离线／隔离验证，未发真实通知、连接券商、合并PR或部署。

## 回滚

revert本批独立提交即可；不改持久化协议、不迁移账户、不回填历史行情，不撤销其他PR，也不用旧ZIP覆盖dev。开发基线完整源码备份、SHA256、本批补丁、原始日志和逐文件指纹在交付目录保留。主线推进时重新检查实际差异和CI，不能用旧分支检查结果代替新候选验证。
