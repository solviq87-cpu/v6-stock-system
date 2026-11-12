# A5：生产信号冻结与私有回放

本批修复审计 `P0-EVID-1` 的同日触发时间错配，并补生产 `S.signals` 的不可变证据。实现不认证供应商、不认证预测概率、不认证收益；以下边界必须保留在验收说明中。

## 已实现的行为

`logSignal` 继续按类型/股票/日期只计一份学习样本，保留首次时间、价格、原模型值、因子和刻度标记。后次登记总是生成独立 `observation` 档案；有新式首样本时以 `supersedes` 指向该首档案，没有旧 ID 时只记明确的 `legacyParent` 身份，不向旧样本补当前版本、时间或报价。历史回验结果字段仍按原学习流程更新；本批没有修改历史输入，也没有删除原统计。

实际 `tick → alerts → S.signals → enqueueIntraday` 路径在入队前冻结 `trigger`：后排、大单、趋势、涨停以及持续大单各自保留原业务条件数值/比较符/门槛、同一原始报价行、资金窗口、实际 K 线行、模型元数据、支持/反证文字、止损参考和观察依据失效条件。趋势状态同时冻结推进前/后状态。新增 `signalId` 和 `evidenceFingerprint` 为内容 SHA-256；策略版本包含本进程启动读取的 `server.js`、`analysis.js` 字节摘要及实际加载的关键函数摘要。它是代码版本标识，运行门槛另存逐条件快照，不是外部签名。

原模型 `model.value/kind/target`、兼容排序 `model.rankingValue/rankingKind` 与独立 `riseModel` 分开。fastin 的主模型针对当日封板，`riseProbOf` 另记次日 +3%；后排复制的 `riseProb` 明记 `copied-from-prob`，仍是当日语义。已封板是观察事实、预测目标为 null。所有冻结模型的 `calibrationCertified` 固定 false，证据封装 `canTrade` 固定 false。

`signal-evidence-chain` 原 schema 1 也已补深拷贝/递归冻结，避免调用者事后修改嵌套信号。原纸面委托意图及证据校验保持兼容。

## 未具备完整逐条件证据的入口

以下实际 `logSignal` 推荐入口已接冻结候选原行、原 K 线、现有模型元数据及可得报价，但旧生产者没有输出完整逐条件门槛：`sector`、`pool`、`trend`、`auczt`、`bigmoney`、`bigmoney-B`、`similar`、`aucres`、`ztsent`、`yier`、`lianban`、`pre`、`buzhang`。不存在 `conditionEvidence` 时条件数组保持空，档案明确带 `INCOMPLETE_TRIGGER_CONDITIONS`；没有根据自然语言逆造数值。它们不能在交接中写成“所有推荐入口已完全可解释”。

新闻目前只留实际布尔命中及原自然语言，原公告/新闻正文档案未由这些路径提供，故明确 `NEWS_ORIGINAL_EVIDENCE_NOT_FROZEN`。缺 K 线、原报价时间、来源、行情用途授权、策略版本或失效规则分别保留缺失原因。状态 `partial` 表示证据缺口；`recorded` 也仅指本封装字段已记录，不代表行情或模型认证。

逐票用途资格由数据专项的同一 `quoteUseEligibility(row, now)` 计算并冻结为 `qualityEvidence`，本批没有第二套用途授权门禁。合同模块尚未提供该导出时明确 `QUALITY_CONTRACT_UNAVAILABLE`，不能由证据归档赋予通知或交易资格。数据专项在实际 tick 的早期用途守卫与本批冻结代码需要同时整合验收。

## 存储、权限及回放

默认目录为服务端 `V6_BO/data/signal-evidence/`；可由服务器启动环境 `V6_SIGNAL_EVIDENCE_DIR` 指定绝对私有目录。客户端没有目录、文件或写入参数。存储布局为北京时间日期/六位代码/64位信号 ID.json，根目录 0700，文件 0600，禁止 public 路径及符号链接。临时独占写入、文件 fsync、无覆盖硬链接发布和目录 fsync 后才返回 archived。相同 ID 的再次归档复用原字节，不覆盖记录。

只读编辑权限 API：`GET /api/signals/evidence?date=YYYY-MM-DD&code=000001&id=<64hex>`；省略 ID 可限量查看该股该日记录，`limit` 1..200。访客/只读账号不可见，响应 `Cache-Control: no-store`，非 GET 为 405，身份无效、缺失指定 ID 或完整性失败为 422，错误不泄漏私有路径。每次读取核对档案哈希、证据哈希及路径身份，不能根据当前行情重建旧档。

档案可在进程重启后按原日期/代码/ID 回放；本批没有恢复内存 `S.signals` 环形列表，也没有改现有推送历史的持久化机制。批次 `signalRefs` 仅包含实际选入正文的信号，新增 ID 贯穿 flush/pushAll/回执，带 ID 的新信号必须匹配 ID、代码、类型和时间才能认领送达。旧记录无 ID 时仅沿用旧三元组，不补 ID。

每股每日上限 2000 档/16MiB，单档上限 600KiB（输入快照 512KiB）。达到容量、权限错误或写盘失败时明确 `evidenceArchiveStatus: unavailable`，不声称可持久回放，不删除旧档；快照本身失败时 ID/fingerprint 为 null。需要运维保留并备份私有目录。本实现是独立内容寻址档案，不是外部公证、全局追加链或防管理员重算哈希；单档篡改和指定 ID 丢失可检测，不承诺检测整日目录被移除后的完整档案数量。

## 验证与回滚

定向行为测试覆盖深冻结、真实 logSignal 同日两次/旧样本/刻度变更、策略切换、原模型与排序分离、真实 tick 条件及入队、归档失败、重启、哈希篡改、私有目录限制、真实 HTTP 鉴权与无路径入口，以及真实批次精确 ID 回执。HTTP 子进程使用隔离配置和合成访问账号；预加载器禁止所有 http/https/fetch 外发，没有发送真实通知或读写生产账户。

复现脚本及 TAP 日志保存在交接目录 `remaining-output/signals-*`。其中 `signals-before-after.json` 对同一个真实源函数反例展示：基线同日第二次把 price 10→12/prob 50→80 且保留旧 ts，修后首样本字节不变，另有两份冻结观察记录。此为源码/fixture 验证，不代表盘中持续供应商、真实消息送达或收益实测。

本分支最终定向结果：`production-signal-evidence`、`production-signal-replay-http`、`signal-evidence-chain`、`dashboard-evidence-integrity`、`dashboard-push-correctness`、`dashboard-push-privacy`、`funds-monitor-continuity`、`six-linkage-persistence`、`dashboard-view` 共 70 tests，0 fail/skip；`_test_auczt_calib.js` 25 断言通过。主服务和两个证据模块语法检查、`git diff --check` 通过。旧 `_test_probkind` 的覆盖首样本断言由概率专项在其文件中移除，改由本批真实源码行为回归接管。

回滚该提交可恢复原生产路径；保留私有档案目录，不执行删除或迁移旧统计。锁定的桌面/手机主页未修改。全量与整合验收由主集成统一记录，本分支仅运行所列定向检查。
