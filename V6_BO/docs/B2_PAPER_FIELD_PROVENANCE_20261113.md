# B2 逐字段模拟执行输入来源｜2026-11-13

后续同一原始行政策修订见 [B2_PAPER_COHERENT_ROW_20261113.md](B2_PAPER_COHERENT_ROW_20261113.md)：新自动成交不再混用缓存价格与旧股票行执行字段；本文保留本批当时行为及旧证据语义。

基线 `9f322e1479b458d230b37b212a562d2d09c84a07`。本批补充 `paperAuthorityQuotes → saveLegacy → fillEvidence` 的输入审计，不改变生产行情、选股分数、执行权限、现金/费用/参与率计算或既有时间门槛。

## 真实混合输入

`paperAuthorityQuotes` 可从新鲜 `S.lastPx` 选择价格及其原始时点，同时从 `S.stocks` 行读取成交量、前收盘、停牌和可交易状态。原有单个 `quoteAt` 只说明选中价格的时点，不能代表其他字段同刻、同来源或已经更新。

反例已执行到真实账户服务的模拟成交：缓存价格 10 元，原始时点距执行 1 秒；股票行来自前一天，量为100个引擎手数、前收盘10元、状态缺失。执行仍沿用原门槛：量转换为10000股，1%参与率允许100股，扣款1005元，现金98995元。把股票行量改为1时，同一个新鲜价格不能通过100股的参与率检查。这些行为没有因新增审计字段改变。

## 新字段

自动报价新增可选 `inputProvenance`，随后深拷贝进入新 `fillEvidence`；`schemaVersion:1`、`mode:'paper-input-audit'`、`independentlyVerified:false`。

| 输入 | 保存内容 | 时间含义 |
| --- | --- | --- |
| `price` | 实际选中的 `S.lastPx` 或 `S.stocks`、价格、声明来源与模式 | `quoteAt/receivedAt` 只取该价格行，缺接收时点保持 `null` |
| `volume` | `S.stocks` 原量、引擎假定的100股手数单位、`rawValue * 100` 与结果 | 字段专属 `quoteAt/receivedAt:null`；原行元数据另存 `rowQuoteAt/rowReceivedAt` |
| `limits.preClose` | 原始前收盘输入、`Number` 转换后数值及原股票行来源 | 没有独立的前收盘源时点，不把原行价格时间当作前收盘产生时间 |
| `limits.rule` | 原股票代码/名称、实际 `limitPctOfCode(code,name)` 结果 | 记录采用的既有代码/名称规则，不声称限制来自交易所认证字段 |
| `limits` | 上下限结果及 `Math.round(preClose * (1 +/- limitPct) * 100) / 100` | 明确为计算结果，使用上面的前收盘输入 |
| `status.suspended/tradable` | `rawBoolean`、原类型、字段是否存在、是否使用默认值、实际采用的布尔值 | 字段专属时点未知；仅保存原行元数据 |

非价格记录的 `timeScope:'row-metadata-only'` 明确限制行元数据的含义；不会借缓存价格时点、列表接收时间或当前时钟填字段专属时点。原行 `mode:'imported'` 等也保留，用于审视混合输入；本批不据此新增交易门禁。字段原始布尔缺失或非布尔时，继续记录既有 `suspended===true`、`tradable!==false` 的实际默认行为。

声明来源/模式最多80字符，名称和原始数值字符串最多120字符，并保留截断标记。专属字段时点没有既有协议可用，因此当前非价格字段为 `null`，将来接通逐字段时间需显式扩展协议。

## 完整性与兼容

元数据必须符合固定结构和版本；仅允许有界JSON（最多200节点、8层、单字符串240字符、总8KiB）。价格/提供方/时点和量、限制、状态结果与受检报价一致，单位转换与限制计算结果也需一致。元数据进入既有证据指纹、订单与资金事件的证据关联和事件/快照指纹。

完整结构与JSON边界在实际成交写入前验证；报价构造只记录输入，避免对未使用的全市场报价逐个序列化校验。

旧证据没有该字段仍可读，保持未知，不补写今天的来源或时点。研究手工填单未提供元数据时记录 `null`，保留原研究用途；原 `requestHash` 和自动流水 ID 算法不变，旧请求重试不生成新元数据。任何输入来源标记均不授予交易权限。成交证据仍为 `canTrade:false`、`verifiedLive:false`。

这是已采用输入的审计来源，不是交易所真实性认证、字段级数据新鲜度保证或外部时间戳签名。拥有文件全部改写权限的人仍可改写无密钥哈希。本批没有修订“旧量/状态能否继续使用”的既有交易政策。

## 实际验证与回滚

- 新增7项行为用例在基线为1通过、6失败；修改后7/7通过。覆盖实际报价函数到 `saveLegacy` 成交、旧/未知原行时点、imported原行模式、缺失/非布尔默认状态、显式布尔与ST限幅、参与率、重启、来源对象不与输入别名、嵌套篡改/订单资金不一致、重算哈希也不接受借时点、边界/版本拒绝、旧证据与旧请求兼容。
- 联合既有账本、应用、投影、跨进程、故障恢复、权威重启、对账、15秒价格边界和权益结算专项：71/71通过。
- `npm run check`、新增与修改核心模块语法、`git diff --check` 通过。全量集成回归由根任务统一执行，本批未执行真实账户、供应商、券商、推送或生产写入。
- 原始日志：交付工作区 `/workspace/remaining-output/ledger-fields-*`。
- 本地6000行合成报价构造的3次计时：基线36/38/102ms，补充字段后62/85/95ms（含分配/GC波动，非生产性能保证）。增加输入记录有内存与计算成本；没有把全市场逐票JSON校验放进报价构造循环。

```sh
node --test tests/paper-field-provenance.test.js tests/paper-fill-evidence.test.js tests/paper-application-service.test.js tests/legacy-authority-integration.test.js tests/paper-unified-view.test.js tests/paper-account-ledger.test.js tests/paper-account-multiprocess.test.js tests/paper-crash-recovery.test.js tests/merged-authority-restart.test.js tests/paper-ledger-reconciliation.test.js tests/paper-authority-quote-time.test.js tests/corporate-settlements.test.js
npm run check
node --check src/core/paper-input-provenance.js
node --check src/core/paper-fill-evidence.js
git diff --check
```

回滚代码即可停止新增字段，不需重算或迁移账户；保留已写入的元数据及指纹，不删改历史。新增证据会增加快照体积，既有20MiB限制未提高，容量不足仍原子拒绝覆盖。
