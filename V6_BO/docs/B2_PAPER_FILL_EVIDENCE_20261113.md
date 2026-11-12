# B2 模拟成交报价证据与历史时间｜2026-11-13

开发基线：`a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47`（本地合入 A1、A2 的集成起点）。本批只修改模拟账本、投影及其实际消费者；pool/pre 继续共用现有权威账户，不改变资金、费用、仓位、冻结或成交量计算。

## 原问题与结果

研究手工成交和自动 `saveLegacy` 已校验报价，却没有把来源与原始报价时点存入最终订单、成交和账户快照。读取旧订单成交时还会把仅知日期补成 09:30，统一只读视图丢掉已知订单关联，网页遇到空时间会显示 1970 年。

新成交保存独立的 `fillEvidence`；订单事件与资金事件保留相同证据，并由原有原子快照提交。原始报价时点、输入接收时点和模拟执行时点分别保存。缺失的旧证据不补写、不反推，新展示明确显示“时刻未知”。已知订单 ID 可追踪，但不会据此伪造迁入前完整的委托/撤单历史。

## 字段与边界

`fillEvidence.schemaVersion=1`，字段包括：

- `executionKind`：`research-manual` / `automatic-paper`；`executionAt` 分别取成交调用时钟 / 自动流水原时点。
- `quoteAt`：原有受检 `quote.timestamp`，若输入也给 `quoteAt`，两者必须一致。
- `receivedAt`：原输入明确提供的接收时间，缺失为 `null`，不以处理时钟或报价时点补齐。
- `source`、`provider`、`mode`、`symbol`、`tradeDate`、实际成交价与输入报价；同时保留成交量及单位、涨跌停输入、停牌和交易标记。
- `fingerprint`：证据内容的 SHA-256 一致性指纹；`verifiedLive:false`、`canTrade:false` 表明归档证据本身不能再次充当执行授权。

证据核对 `quoteAt <= receivedAt <= executionAt`（接收时点未知时只核对已知两项）、同一 A 股日期、输入价格和限制字段，并与订单和资金事件关联。研究手工用途仍允许 `simulated` / `imported`，并明确显示“模拟输入”或“导入研究”；未把手工研究用途改成生产实时用途。公开报价仅标记 `public-live-unverified`，不能据此宣称供应商认证。

自动主引擎的原始报价 15 秒门禁继续由原执行路径控制；研究 API 的 180 秒用途阈值未放宽。证据校验不重新按当前读取时间判旧成交过期，重启后读取历史仍可验证当时的相对时序。

原有 `requestHash` 算法保持不变，同一旧请求重试在创建新证据之前返回；自动原始流水重复提交复用原确定性 ID，不重复扣费。新证据同时进入账户事件、账户指纹、订单/账户关系和事件指纹校验。

## 旧数据与日期消费者

旧快照仍按 schema 1 读取，无 `fillEvidence` 的事件保留未知来源/报价时点。有原始执行时间的历史保留原值；只有交易日期的订单事件投影为 `t:null`、`timeQuality:'date-only'`。迁入前原始历史不改写。

首次新增证据事件时记录 `fillEvidenceVersion=1` 与 `legacyFillEvidenceCount`，既有无证据前缀原样保留；此后事件不得无故缺失证据。重置/改本金的既有归档流程同时归档这两个字段，新空账户重新建立边界。

持仓保留 `buyDate`；只有真实已知时刻才填写 `buyTs`。T+1 和按交易日到期的巡检可使用已知日期作日历计算，不把日历计算用的中午基准回写为执行时刻。自然日精确时长未知时不声称已经过多少天。网页空时间显示“日期（时刻未知）”。锁定的 `public/index.html`、`public/mobile.html` 未修改。

## 实际验证

定向验证与原始日志存放在交付工作区 `/workspace/remaining-output/ledger-*`；这不是生产验收或远端 CI 证明。

- 新增 `tests/paper-fill-evidence.test.js` 的 13 项行为测试在上述基线为 0/13 通过，修改后为 13/13；与下列既有专项联合执行共 64/64 通过。`npm run check`、所有修改的核心模块语法检查和 `git diff --check` 通过。
- 新增行为测试覆盖原始报价/接收/执行时点、来源/模式、未知接收时点、重启、跨订单重复 eventId、自动原流水重试、旧 requestHash、旧无证据前缀增量升级、内层证据篡改、订单/资金证据不一致、去除新证据、实际网页渲染、日期 T+1 和到期巡检。
- 既有定向回归覆盖账本、应用服务、共享权威账本重启、跨进程锁、故障恢复、对账、报价 15 秒边界和公司权益结算。
- 全量回归、合并后的服务启动与最终提交验收由根集成任务统一执行。本分支未声称通过尚未执行的集成或线上检查。
- 本批为时间与来源展示修复；原图 1:1 真机视觉验收未完成。

可在 `V6_BO` 重跑：

```sh
node --test tests/paper-fill-evidence.test.js tests/paper-application-service.test.js tests/legacy-authority-integration.test.js tests/paper-unified-view.test.js tests/paper-account-ledger.test.js tests/paper-account-multiprocess.test.js tests/paper-crash-recovery.test.js tests/merged-authority-restart.test.js tests/paper-ledger-reconciliation.test.js tests/paper-authority-quote-time.test.js tests/corporate-settlements.test.js
npm run check
git diff --check
```

## 回滚与限制

先备份并核对私有账户快照、修订号、现金、事件数及哈希，再回滚代码。不要删除新字段或把旧快照覆盖到已发生新成交的账户。旧读者可以忽略可选字段，但旧写者可能在新证据边界后追加无证据事件；因此不能直接降级可写实例继续成交。回滚期间应暂停模拟写入，保留完整新快照，完成兼容核对后再恢复。

这些哈希用于内容完整性与关系一致性检查，不是外部签名：拥有全部文件改写权限的人可连同哈希与格式标记一起改写。本批不把输入报价认证为真实市场成交，也不独立认证成交量与涨跌停数据来自何时。未连接真实券商、账户、消息通道或生产写入；多机实盘、物理断电和跨主机故障演练未执行。
