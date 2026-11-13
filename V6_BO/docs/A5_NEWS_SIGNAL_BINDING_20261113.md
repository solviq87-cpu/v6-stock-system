# A5：生产信号绑定触发时已知的本地新闻版本

基线 `7ef3d560bdcc3a1b02fe17eae6f07ccc4a37ae26`。本批补上 `captureProductionSignal` 原来固定 `originalEvidence:null` 的缺口，复用已有 `news-evidence-journal`，不新增供应商请求、采购、通知、交易或训练任务。两张锁定主页及四策略、分数、权重、旧关键词分类未改。

## 入口与证据含义

`logSignal` 观察档案、真实 `tick → S.signals → enqueueIntraday` 触发档案及持续大单都经由原 `captureProductionSignal`。该函数现在只读服务端固定私有目录，调用 `src/core/news-signal-evidence.js`，把引用冻结进原 schema 2 的 `inputs.news`。客户端和候选行不能指定目录，也不能通过 `extra.news.originalEvidence` 注入虚假原文；原 `goodHit/badHit` 字段继续保留。

`binding.association=same-security-context` 仅说明本地来源版本提到同一证券，不能证明它导致了某次关键词命中、属于利好或构成推荐因果。引用包含来源、事件/版本 ID、版本及前链 hash、`supersedes`、链接、标题、`bodyHash/bodyScope`、证券列表、来源发布/接收/修订时点和本地 `recordedAt`。不复制正文，`bodyIncluded=false`；原内容仍由保留的私有 journal 以版本 hash 追溯。

`provider-summary` 只冻结摘要范围及其 SHA，不冒充完整正文。来源时间、完整正文或链接未知保持原 null/范围及缺口；不会以触发、接收或导入时间补发布时间。所有认证、交易、训练、通知标志仍为 false，`eligibleForResearchSupport` 最多表示来源声明可用于人工研究，不能证明来源真实性。

## 时间与修订顺序

读取 journal 使用实际读取时钟 `now`；选择证据使用原信号 `record.ts`，即 `triggerAt`，二者不能混用。先在每个 `source/eventId` 的链中选 `recordedAt <= triggerAt` 的末版，再处理证券关联；同时检查来源 `publishedAt/receivedAt/revisedAt` 均符合时点和链规则。来源发布时间很早、接收时间也很早，但事后才导入的记录不会被当成此前已知。新缓存回看旧触发时点，事件版本和 `asOfHeadHash/asOfSequence` 都重新截止到旧时点。

同事件已知修订即替代旧版；修订时间未知不允许回退旧版。撤稿为终态，撤稿及被替代版本永远不能作正面支持。修订移除该证券时也不能让旧关联复活，仍保留 `SECURITY_REMOVED` 诊断。`binding.versions` 保留本次有界链中各版本的 current/eligibility/问题记录。

既有 schema 2 对 `originalEvidence` 只检查真值，因此本批绝不传空数组或 partial 对象来消除缺口。只有本次选中的当前版本无缺口，且至少一条是合格的 `declared-body` 引用时，`originalEvidence` 才为非空数组。任一当前事件仍是摘要、撤稿、移除关联或未知时点时，保守保留 `originalEvidence:null`，完整诊断放在 `binding`，外层继续带 `NEWS_ORIGINAL_EVIDENCE_NOT_FROZEN` 和 partial。归档成功也不认证其余条件全部完整。

## 有界只读与缓存完整性

冷读、目录追加或替换先复用 journal 验证整条链。目录最多 10000 版/128MiB、单文件 128KiB，复核期间发现锁、符号链接、权限暴露、缺档、链/hash 损坏即拒绝。结果不泄漏私有路径，也不创建缺失目录或删除已有文件。

每个配置目录缓存已验证的事件链与证券索引，最多缓存 4 个目录；每信号最多 256 个当时已知的同股事件、32 个版本和 64KiB 输出，超过即 partial，不提供截断后假完整的原文。缓存内用时间二分定位末版，未来才新增的证券关联不占用过去触发的候选额度。目录不变时复用全链内容验证，不为每个信号重读全部正文。

每次输出的全部版本引用及触发时的 journal 链头都重新开文件核对内容 hash；目录版本变化立即重新验证整链。另每最多 1000ms 对全库有界文件元数据复核，发现任一文件原地变化则重新验链。`validationScope=cached-full-chain-and-current-reference-hashes`、`chainVerifiedAt`、`chainMetadataCheckedAt`、`metadataCheckMaxAgeMs` 和 `referencesVerifiedAt` 明示校验范围与实际时点：**不是每次捕获都重算最新全库内容**。非本次引用、也非截止链头的中间文件原地损坏，最迟在下一次到达该 1 秒复核间隔的查询发现；选中的引用损坏当次即拒绝。

本地 hash 仍不能阻止有权限者整套重建、删去完整末尾或系统时钟回拨，继承原 journal 的独立备份/末端 hash 运维边界。绑定失败仅补证据缺口，不阻断原监控或生成新资格。

## 兼容、代码清单与回滚

固定 source manifest 新增实际依赖 `news-signal-evidence.js` 与 `news-evidence-journal.js`，从 16 项变为 18 项；只读代码，不读配置/账户/统计。schema 2 创建/校验算法及旧档案字节不变，不迁移、不回填旧信号。新增引用随新信号原有不可变档案保存，重启读取信号档案无需重查或重建当前新闻。

回滚本提交即可移除新接入，保留全部私有新闻和信号档案，不删除或覆盖历史文件。无需部署、合并或任何真实通知来验证本批。

## 实际验证

定向测试运行：

```sh
node --test tests/news-signal-evidence.test.js tests/production-signal-evidence.test.js \
  tests/production-signal-replay-http.test.js tests/signal-evidence-chain.test.js \
  tests/signal-condition-producers.test.js tests/signal-rule-manifest.test.js \
  tests/news-evidence-journal.test.js tests/news-evidence-http.test.js \
  tests/news-china-cloud-timezone.test.js tests/dashboard-evidence-integrity.test.js \
  tests/dashboard-push-correctness.test.js tests/dashboard-push-privacy.test.js \
  tests/funds-monitor-continuity.test.js tests/six-linkage-persistence.test.js tests/dashboard-view.test.js
```

实际结果为 **118 tests，118 pass，0 fail/skip**，日志 `/workspace/next-output/news-affected-final.tap`；主服务/新模块语法检查和 `git diff --check` 日志为 `news-static.log`。两张主页 Git Blob 与基线完全一致。模块专项覆盖原/修/撤、晚导入、未知来源时间、未来缓存回查、删股修订、缓存损坏、锁/权限/缺档、容量和无写入。生产专项直接执行真实 `logSignal/tick/captureProductionSignal`，验证档案 hash、旧字节不变和旧 schema 2 继续可读；HTTP 子进程验证真实私有回放和重启。

另以 `/workspace/next-output/news-deny-egress.cjs` 禁止 http/https/net/tls/dns/fetch，执行生产和模块专项，**31 tests 全通过，网络尝试为 0**，日志 `news-no-egress.tap` 保留计数。所有输入均为本地 fixture，未访问真实供应商、发通知或接触生产账户。全量回归和最终整合由根任务统一运行，本分支不以专项通过代替全量验收。
