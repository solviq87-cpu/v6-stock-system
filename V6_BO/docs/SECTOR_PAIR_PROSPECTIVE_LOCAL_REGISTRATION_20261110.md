# V6 板块供应商质量研究：先登记、后取证、再审核（2026-11-10）

## 功能边界

既有 `sector-provider-pair-quality.js` 接受操作者事后提交的 `expectedSignalDates`、质量阈值与 `registeredAt`。尽管它会检查时间字段并把缺失档案计入分母，**操作者仍可能事后改写整份输入及其时间字段**。因此本批新增独立的**前瞻本地登记回执**：在首个研究日期北京时间09:30**之前**，预先锁定整个研究区间、所有预期信号日、双方供应商身份与比较规则，再要求后来质量报告匹配锁定的回执。

**重要：旧的 `sector-provider-pair-quality.js publish` 仍是原有的、未绑定登记回执的纯描述性研究接口；需要“按预登记清单核对”的研究必须使用本批 `sector-provider-pair-register.js preview/publish`。不能把旧报告当成已登记证据。**

本地登记**不是外部可信时间戳**。操作者可以回拨系统时钟、在另一机器重建伪回执、删掉整个私人研究目录，或通过管理员权限修改磁盘。SHA-256、文件建立时间和本地原子写入都不能防御这些威胁，也不证明供应商许可、真实行情、真实前瞻样本或模型有效性。要升级证明力，需要把回执指纹在截止前投递至**独立可信第三方时间戳／独立审计系统**，并核查外部回执与本地登记是否一致；本轮没有建立这项外部连接。

## 三个命令

在 `V6_BO` 目录：

```sh
node scripts/sector-provider-pair-register.js register /private/plan.json /private/registrations/study-001.json
node scripts/sector-provider-pair-register.js preview /private/registrations/study-001.json /private/evidence.json
node scripts/sector-provider-pair-register.js publish /private/registrations/study-001.json /private/evidence.json /private/reports/study-001-quality.json
```

`register` 明确创建**本地仅一次**的0600权限回执；若同名文件已存在，不允许覆盖或改变历史时间，只能验证原回执与输入计划一致。首次登记失败不创建任何有效研究回执。`preview` 只读；`publish` 先严格回放所有原来的复权价格与指数证据门禁，然后在私有目录原子创建0600报告，不允许覆盖已有不同内容；相同回执、相同输入与同一计算结果重放可以沿用原发布时间，输出 `changed:false`。所有命令离线，无网络访问。

`plan.json` 格式：

```json
{
  "schemaVersion":1,
  "mode":"sector-pair-prospective-registration-plan",
  "source":"operator-declared",
  "studyId":"study-001",
  "tradeDates":["2026-11-10","2026-11-11"],
  "expectedSignalDates":["2026-11-10"],
  "identity":{
    "source":"eastmoney-clist-unverified-live",
    "membershipProvider":"baostock:query_stock_industry",
    "classificationVersion":"baostock-csrc-2026-11-frozen",
    "primaryAdjustedProvider":"provider-alpha",
    "secondaryAdjustedProvider":"provider-beta",
    "primaryIndexProvider":"index-alpha",
    "secondaryIndexProvider":"index-beta",
    "indexCode":"000300",
    "maxStockReturnDifferenceBps":20,
    "maxIndexReturnDifferenceBps":10
  },
  "policy":{
    "schemaVersion":1,
    "mode":"preregistered-sector-provider-pair-quality",
    "minMaturedSessions":5,
    "maxDisagreementRatePct":10,
    "maxNonComparableRatePct":20
  }
}
```

**注意：以上仅是字段示例，因交易日历短于22天会被拒绝，不能直接运行。** 实际输入必须包含完整且已核对交易所法定休市日的交易日历、1–90个严格升序预期信号日和全部供应商标识。研究计划**不得自行填写** `registeredAt`；登记程序在创建回执时取其本地时钟。对于首个日期已过9:30的计划，登记程序直接拒绝，不支持事后补录和“重新盖章”。

`evidence.json` 采用上一轮既有质量审计输入结构：`schemaVersion:1`、`mode:"sector-provider-pair-quality-imported-input"`、`source:"imported"`、`tradeDates`、`expectedSignalDates`、`policy`、`episodes`、`asOf`。唯一变化是此处的 `policy` 必须原样包含回执程序生成的 `registeredAt`，其它研究字段必须与回执一致。每个 `episode` 仍由完整冻结成分、原始报价、公司行为、双供应商调整价与总收益指数证据组成，绝不能手填单纯的“日收益百分比”。

## 明确阻断

- 登记结束后改变预期信号日、日历、质量阈值或供应商身份；同名回执内容不同；登记回执 SHA 不匹配；更改登记时间；引入不允许的额外回执字段；
- 与回执不同的研究输入，包括减少原计划中的预计日期、同名供应商变更、将未登记供应商拿来参与原有审计；
- 把冻结时间早于登记时间的历史信号偷放到本研究中；违规修改单批双源比较阈值；
- 重复预期信号日、过早成熟、来源不一致、复权缺失或公司行为原始证据被改写：继续交给已通过回归的完整双源和跨日质量门禁检查。

计划中预计有信号，但该日档案缺失，仍计入质量统计的非可比样本；不会缩小原日期列表重新得出“100%数据完整”的误导结论。已锁回执和结果都只能做**本地一致性检查**。

## 测试与不可触碰范围

```sh
node --test tests/sector-provider-pair-rolling-quality.test.js
npm run check
npm test
```

输入为离线合成数据，CI通过不是长期供应商验收、不是模型样本外预测力认证。回执与报告始终 `canTrain:false`、`canTrade:false`、`prospectiveCertified:false`、`externallyTimestampCertified:false`。本轮不碰四套正式选股策略、模拟盘、行情主源、账户、锁定的 `public/index.html` / `public/mobile.html`、云部署或真实交易。
