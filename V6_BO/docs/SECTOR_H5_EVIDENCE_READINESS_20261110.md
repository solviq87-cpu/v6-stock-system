# V6 板块 H5：单日冻结证据就绪检查（不补造历史）

2026-11-10。此功能连接当日行业/行情研究与已有 PR #100、#125、#132 的 H5 原始证据重放：**先报告缺什么，再决定是否足以交给后续的多日私有审计**。不读取网络、不自动冻结信号、不生成未来行情、不回填历史，不写账户、观察池或模型。

## 两种入口

代码层：

`inspectSectorH5DailyReadiness(entry,{tradeDates,asOf})`

单日私有文件只读命令：

```sh
cd V6_BO
node scripts/sector-h5-evidence-readiness.js once \
  /private/v6/sector-h5-day.json \
  /private/v6/a-share-calendar.json
```

可选 `--as-of-ms <当前或过去的UNIX毫秒>`，不允许传未来时间。输入使用私有**绝对路径**普通JSON文件，不得为符号链接，不得位于任何 `public` 静态资源目录；单日证据上限8MiB，日历上限1MiB。不允许任何写文件参数。输出唯一一行JSON，退出码：`0` 表示该日证据足以进入**后续研究历史审计**，`2` 表示证据尚不完整或阻断，`1` 表示路径/格式/文件异常。

单日文件的外壳：

```json
{
  "schemaVersion": 1,
  "mode": "sector-h5-single-day-readiness-input-unverified",
  "entry": {
    "snapshot": {},
    "membership": {},
    "preflightAsOf": 0,
    "preflight": {},
    "industries": []
  }
}
```

**这只是字段结构示意，不能直接运行或用于真实收益。** `snapshot` 必须是当天真实留存的行情原始快照；`membership` 必须是行情采样前冻结的全体行业及成员；`preflightAsOf` 应是当时的研究预检时钟；`preflight` 必须是当时实际保存的 `inspectSectorShadowEligibility` 结果，不能事后补写为“当时冻结”。`industries` 为当天**所有已排名行业**的 `{sectorCode,cohort,market,label}`；缺的字段可以省略，让审计报告“缺失”，但不能拿事后编造的冻结记录替代。逐份 `cohort` 需由已有 `freezeCohort` 在**信号日当天**产生，`market` 是之后取得的同源未复权日K，`label` 是此前保存的H5研究标签。

交易日历文件使用已存在的 `sector-h5-raw-replay-audit.js` 同一协议：

```json
{
  "schemaVersion": 1,
  "mode": "a-share-explicit-trade-calendar-unverified",
  "source": "imported",
  "tradeDates": ["2026-11-09", "2026-11-10", "2026-11-11"]
}
```

日期仅为结构说明；实际日历必须包含目标信号日起至少后续5个**真实A股交易日**，可有至多1200个升序日期，不能将周一至周五或自然日擅自代替交易所日历。任何来源/日期错误都阻断。

## 就绪诊断分层

- **缺原候选**：当天仍在原始观察日期时返回 `freeze-today-candidate-required`；日期已过去返回 `past-candidate-not-frozen`，不会重新生成“历史已冻结候选”。
- **缺行业冻结cohort**：当日为 `needs-same-day-cohort-freeze`；过去日期为 `missing-cohort-cannot-backfill`。强制校验5～500只完整成员、信号去重、冻结指纹/来源/原始时点。大于500成员的行业直接阻断，不能抽取表现好的500只。
- **缺未来行情/尚未成熟**：区分 `await-h5-price-market`、`h5-price-evidence-missing`、`pending-future-session` 和 `partial-h5-evidence`。公司行为、停牌或缺价不当作零收益。
- **有价格但未保留已计算标签**：`needs-h5-label-review`；不会自行写入标签。已提供的标签与原始价格重算不符时直接 `blocked`。
- **当天所有行业均满足重放**：`ready-for-history-audit-unverified`，`allLabelsReplayed:true`。这只表示**该日**内部证据足够，可与其他不同日的记录一同送入 PR #132 的完整非重叠 H5 历史评分；不是已经满足 24 日要求或具备训练能力。

同日不同来源、交易日历和 H5 目标日冲突、重复行业或跨行业重复股票、分类变更、被篡改的预检、冻结cohort、价格或收益均保守阻断。实际日历和证据的**外部真实性、独立时间戳、法律许可、模拟成交条件**仍待核验。

## 保留永不晋级的安全边界

所有路径恒 `canTrain:false`、`canTrade:false`、`canWrite:false`、`canNotify:false`、`outOfSampleValidated:false`、`weightsChanged:false`、`readyForTraining:false`。单日审计不是策略选股、交易信号或自动学习证据。不会调用 `factor-shadow-worker`、实盘或模拟盘成交链路。

## 回归

```sh
node --test tests/sector-h5-evidence-readiness.test.js tests/sector-h5-evidence-readiness-cli.test.js
npm run check
npm test
```

专项测试使用**纯合成**的行业成员、当日报价与未来日K验证已冻结/缺失/历史无法补造、未成熟、收益被篡改、假日历、成员超过上限、源变更、私有路径与退出码。测试通过不等于真实行情数据已就位、国内部署上线或收益有预测价值。严格不修改两张锁定主页、四套正式策略、15因子、模拟盘与现有多源采集或其他AI并行PR。