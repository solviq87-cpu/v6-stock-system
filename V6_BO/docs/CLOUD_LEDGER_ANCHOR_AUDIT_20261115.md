# 天枢智策 V6｜CAS 账本历史头锚与回滚只读审计（2026-11-15）

## 为什么增加本门禁

追加式 CAS 账本每条事件包含前哈希、全文件摘要、全局版本和幂等请求 ID。它能检测**破损、插入、缺口和未重新计算哈希的改写**，但它自己无法阻止操作者把最新若干条事件删除后，将账本替换成某个仍然自洽的早期版本。**只检查哈希链“通过”，并不等于最新账本已恢复。**

新增纯只读 CLI `V6_BO/scripts/cloud-records-ledger-anchor-audit.js`，读取现有隔离 CAS 根目录，核对事件链与外部留存的**精确当前头版本号 + 头哈希**。可选比较最近一次受信快照的规范化哈希。它不修复、不迁移、不写回、不推送、不使用分享码，也不会更改原来两个被锁定的首页、策略、发布者或 WorkBuddy 单文件站点。

## 使用方法

前置条件：在获授权的私有环境中，先从**独立、安全留存的位置**取得可信账本头版本号、哈希及可选快照哈希；真实账户仍在冻结／只读核查阶段时，由有权人员核对出处。不可用本脚本首次打印的哈希作为它自己的独立外部证明。

```sh
# 不要在公共终端、Issues、CI 或聊天中暴露真实私有路径与凭据。
V6_CLOUD_LEDGER_AUDIT_ROOT=/private/v6-ledger \
V6_CLOUD_LEDGER_EXPECTED_REVISION=2 \
V6_CLOUD_LEDGER_EXPECTED_PROOF_SHA256=<事先独立留存的64位十六进制头哈希> \
V6_CLOUD_LEDGER_EXPECTED_SNAPSHOT_SHA256=<可选的独立留存快照哈希> \
node V6_BO/scripts/cloud-records-ledger-anchor-audit.js
```

- 必须是**仓库以外**的绝对私有根路径；沿用 CAS 模块原有的私有目录、不可跟随符号链接、事件权限及哈希校验。目录不存在、无权威初始化历史、事件不连续或被篡改时拒绝。
- 不提供外部头锚时，可以只进行 `verified-chain-unanchored` 内部完整性审计，**不可将此标记为防回滚验收**。
- 外部版本与哈希必须**成对提供**，并精确对应当前事件头；通过仅输出 `head-anchor-matched-only`。若历史已追加新的合法提交，旧锚也会不匹配：必须先保留完整新历史、核对其来源和新旧衔接，而不是删除事件或直接替换锚。
- 可选的 `V6_CLOUD_LEDGER_EXPECTED_SNAPSHOT_SHA256` 应来自独立留存且与**当前内容**对应的已核验快照。此前通过备份预检得到的初始快照哈希，只在账本尚未合法更新时才应与当前状态相同。
- 无法确认来源的外部版本号或哈希即使相符，也**不代表**来源可信。 `externalAnchorProvenanceVerified=false`、`endToEndRollbackProtectionVerified=false`、`backupAuthorityVerified=false`、`accountHistoryReconciled=false`、`accountRecoveryVerified=false` 均保持原样。
- 审计工具只输出哈希、版本、数量、无敏感数据的失败代码；**不打印**资金、持仓、账户明文、备份/存储私有路径、令牌和整个错误堆栈。
- 根目录残留 `.stage-<24位十六进制>` 暂存文件时，本审计显式拒绝 `UNRESOLVED_STAGING_ARTIFACT`。它可能来自中断写操作，必须先人工调查，不自动删除或清除账本。
- 运行期间目录文件清单变化时拒绝 `LEDGER_CHANGED_DURING_AUDIT`；审计输出仍只是一次**时间点快照**，不意味着之后不再有写入。上线持续可靠性需要真实备份、持久卷、受信外部锚定及实时对账。

## 失败门禁和自动测试

退出码 0 表示本次只读检查通过；退出码 2 表示 `blocked`。常见的脱敏机器码：`AUTHORITATIVE_LEDGER_UNAVAILABLE`、`HEAD_ANCHOR_MISMATCH`、`SNAPSHOT_HASH_MISMATCH`、`UNRESOLVED_STAGING_ARTIFACT`、`LEDGER_VERIFICATION_FAILED`。失败时**不自动生成新的账户、不清空文件、不重新初始化，也不通过 HTTP 自动重试更新**。

```sh
node --check V6_BO/scripts/cloud-records-ledger-anchor-audit.js
node --test V6_BO/tests/cloud-records-ledger-anchor-audit.test.js
```

`.github/workflows/v6-ci.yml` 为每次 PR/push 增加单独的 `cloud-records-ledger-anchor-audit` 明确状态；同时保留已有账本、HTTP 登录、WorkBuddy 和全量回归检查。合成数据覆盖：无锚与有锚、合法链回滚、合法后续更新、错误/缺失锚、旧事件篡改、暂存残留、非法/符号链接根路径、双设备版本冲突及重启、CLI 只输出脱敏证据。没有授权的真实账本备份时**只能证明代码回归**，不能宣称线上历史已恢复。

## 上线阻塞仍然有效

本审计没有真实 WorkBuddy 分享码、运营者账本备份或生产持久卷，不会擅自读取、导入、启动新后端或向真实飞书发送消息。云端正式迁移还必须完成：权威来源独立证明、资金/冻结/持仓/成交/撤单/流水的逐条对账、真实双设备登录与撤权、持久卷重启及断线对账、风险提示无旧报价污染、私有飞书送达与生产回滚预案。未经这些核验不改变 `productionDeployed=false`，不开放生产账户写入。
