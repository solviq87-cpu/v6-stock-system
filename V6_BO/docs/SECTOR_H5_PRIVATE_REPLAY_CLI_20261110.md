# V6 板块 H5 原始证据重放：私有文件只读命令

2026-11-10。此命令把已合并 PR #125 的原始证据重放 + PR #108 的 H5 非重叠评分接到一个**真正可运行、只读**的运维入口。不访问网络，不创建归档，不修改账户、模拟盘、正式选股策略/因子或任何主页；它也不能收集或提供用户未授权的数据。

## 运行

准备**两个已有的私有绝对路径 JSON 文件**，不要放在 `public` 目录，也不要使用符号链接。原始证据文件（示例仅说明结构，不代表真实行情）：

```json
{
  "schemaVersion": 1,
  "mode": "sector-h5-private-raw-batch-unverified",
  "entries": [
    {
      "snapshot": "同日完整市场快照对象",
      "membership": "当时冻结的全部行业及成分股对象",
      "preflight": "当时预检的完整输出",
      "preflightAsOf": 1762761600000,
      "industries": [
        {
          "sectorCode": "BS_真实行业ID",
          "cohort": "当日该行业已冻结的完整信号队列",
          "market": "未复权未来日K和显式交易日历",
          "label": "已提交的H5行业收益研究标签"
        }
      ]
    }
  ]
}
```

实际 `entries` 必须包含**24～80 个**不同交易日，每天 `industries` 必须覆盖全部排名行业，股票和价格对象必须是真实JSON对象，不能使用上面说明性的字符串。信号必须在当日冻结；不能事后用新信息补建队列。没有足够样本时，命令按协议输出阻断，而不是捏造研究分数。

交易日历文件：

```json
{
  "schemaVersion": 1,
  "source": "imported",
  "mode": "a-share-explicit-trade-calendar-unverified",
  "tradeDates": ["2026-01-05", "2026-01-06", "2026-01-07"]
}
```

日期数组展示只是格式示意；真正运行至少需要 150 个严格升序的显式 A 股**实际交易日**（上限1200），不能简单使用工作日代替交易日。对研究输入，`snapshot`、`membership`、`preflight` 等字段的具体协议须与现有 `sector-shadow-learning-preflight`、`forward-signal-observer` 和 `sector-h5-raw-evidence-replay` 一致。

```sh
cd V6_BO
node scripts/sector-h5-raw-replay-audit.js once \
  /private/v6/sector-h5-raw.json \
  /private/v6/a-share-calendar.json \
  --cost-bps 30
```

选填 `--as-of-ms <unix毫秒>` 可使用**不晚于本地执行时间**的研究截止时钟，不支持未来时点。

## 行为与退出码

- **退出码0**：输出一行JSON，`status=private-raw-replayed-descriptive-unverified`；提供训练研究、验证研究、保留测试研究各段汇总、成本压力假设、原始输入文件 SHA-256 摘要、研究证据摘要。此状态仅证明该批输入**内部重算一致**，不代表真实前瞻认证。
- **退出码2**：资料不足、超出协议、冻结材料不一致、未来日期、数据时间/来源/收益冲突等，`status=blocked`。不输出任何部分可误读成完整评分的折叠结果。
- **退出码1**：路径、文件、JSON/语法等操作输入无效，`status=failed-private-input-validation`。标准错误不回显私有路径、原始股票代码、JSON正文或凭据。

安全上限：原始批文件≤32MiB、交易日历≤1MiB，输入必须是非符号链接的普通文件（所有现有路径父目录同样禁止符号链接），不能读取公开静态目录。禁止不明选项、写文件参数以及自动循环；不会在本地或云端保存输出，也不会自动安排定时采集。

## 重要边界

`batchSha256`、`calendarSha256` 只是用户提供的本地JSON的内容摘要。持有文件写权限的人仍可能先改内容再重算摘要，故**不能**当作外部可信时间戳、第三方独立验收或来源许可证明。输出永远 `canTrain:false`、`canTrade:false`、`canNotify:false`、`outOfSampleValidated:false`、`eligibleForResearchPromotion:false`、`weightsChanged:false`。即使全绿，仍须积累真正独立的前瞻材料、许可、可成交性及费用证据，才能讨论可信收益。没有将已有数据模拟为真实市场记录。

## 测试

```sh
node --test tests/sector-h5-raw-replay-cli.test.js tests/sector-h5-raw-evidence-replay.test.js
npm run check
npm test
```

专项测试覆盖从合成原始价量→冻结cohort→H5成熟标签→24次原始重放→固定样本段评分的真实模块调用，另外核对伪造原始标签、缺行业、非交易日历、符号链接、公开目录、超大文件、未来研究时钟、脚本退出码及私有路径不泄露。合成测试成功不代表国内服务器部署或真实行情数据验收。