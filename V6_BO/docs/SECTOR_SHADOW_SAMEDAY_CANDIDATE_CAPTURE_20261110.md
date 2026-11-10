# V6 板块强度候选：当日预检原始证据封存

2026-11-10。这是板块证据链的**当日捕获入口**，解决在 PR #143 的单日就绪审计发现缺少历史 `preflight` 时，操作者没有标准化、不可覆盖的及时留存方式的问题。本模块只固定原始行情、分类和研究预检，**没有冻结个股收盘基准价的 `freezeCohort`，没有生成 H5 收益，也没有接入自动学习/真实交易**。

## 使用前提与运行

操作者必须已经合法取得并保存两份私有的、完整的原始文件：

1. `<snapshot.json>`：已有 Eastmoney 行情研究快照，包含 `date`、`startedAt`、`retrievedAt`、`universeSize`、每股 `code`、`pctChange` 和供应商自报的 `vendorQuoteAt`。缺少足够的当日原始报价时间/上涨广度、报价过时、异常数据混源或快照数据不完整则阻断。
2. `<membership.json>`：行情采样前的全行业完整成分股分类，包含 `source: "imported"`、`provider`、`classificationVersion`、`tradeDate`、`observedAt` 与所有 `sectors` 的 `memberCount`/股票 `members`。须和快照日期一致。**现有 BaoStock 行业分类是当时获取的快照，不能自称多年前的真实历史成分。**

```sh
cd V6_BO
node scripts/sector-shadow-candidate-capture.js once \
  /private/v6/quote-snapshot.json \
  /private/v6/frozen-industry-membership.json \
  /private/v6/candidate-archives
```

必须在行情 `retrievedAt` 之后最多5分钟内运行，且当前北京时间日期必须与快照交易日一致。这里的5分钟约束约束的是**运行时本地时钟**，并没有独立认证运行时钟的外部可信性，不能回溯跑旧日快照来虚构研究前瞻表现。

所有输入/输出路径必须为绝对私有路径，拒绝符号链接和 `public` 静态目录。单份输入最大16MiB、输出候选档案最大40MiB。命令不会访问网络、购买行情、生成价格、注册定时任务或发送提醒。输出目录只在全部当日质量检查通过之后才创建。

## 不可覆盖的归档

单日固定文件：`candidate-YYYY-MM-DD.json`，权限为0600，只允许一个相同日期/身份的档案。写入临时文件并 `fsync` 后，以原子硬链接方式发布。已有文件绝不覆盖。

归档中包含：

- `schemaVersion: 1` / `mode: "sector-h5-single-day-readiness-input-unverified"`
- `entry.snapshot`：原始当日行情快照
- `entry.membership`：已经提供的冻结行业与成分
- `entry.preflightAsOf`：当时行情采样结束时钟
- `entry.preflight`：以原始输入重新计算的影子研究预检（包含同日行业排名和每组成员SHA-256）
- `entry.industries: []`：**明确尚无** 个股价格 `cohort`、未来行情/收益
- `candidateCapturedAt`、原始文件字节SHA-256，以及自校验 `integrity` 摘要

第一次运行如果通过，输出 `same-day-candidate-captured-unverified`（退出码0）；同一套原始文件再次运行，会核对既有封存时点、预检及原始文件摘要完全一致，返回 `already-frozen-identical`（退出码0），**即使此时已过当日五分钟采样窗口，也仅允许读取相同档案，不得重新冻结**。若原始文件变了、日期冲突、历史归档损坏，则阻断且不覆盖（退出码2）。私有路径、JSON或文件系统无效返回失败状态且不泄露私有路径（退出码1）。

任何人只要能篡改原始JSON和归档、再重新计算摘要，就仍可能伪造内部一致性。因此**SHA256与本地 `candidateCapturedAt` 不等于独立外部时间戳、公证、交易所认证、行情许可证或证明数据确实在过去存在**。不可覆盖机制只是当前进程和文件路径的保护，用户应另行建立受控访问/不可更改的独立备份。

## 如何与后续研究连接

这份 `candidate-YYYY-MM-DD.json` 与已合并的 [PR #143] 所用单日就绪输入具有相同 `mode` / `entry` 结构，可以直接作为检查器的第一个参数：

```sh
node scripts/sector-h5-evidence-readiness.js once \
  /private/v6/candidate-archives/candidate-YYYY-MM-DD.json \
  /private/v6/a-share-calendar.json
```

此时应看到的是需要同日 `cohort` 冻结，而不是“历史收益已成熟”。还需额外拿到当日完整股票收盘价，并按现有 `freezeCohort` 合法及时冻结每个行业的**全体成员**；第5个真实交易日完成后，再以同源未复权价格/停牌/公司行为运行 H5 标签及 PR #125/#132 的原始证据重放。**不得直接修改这份当日候选文件添加未来证据**，应另外组成后续审计用的研究批次，保持此档案不变。

## 回归

```sh
node --test tests/sector-shadow-candidate-capture.test.js
npm run check
npm test
```

测试模拟当日冻结、5分钟后重试不覆盖、修改报价文件导致冲突、损坏档案拒绝、过去日期禁止补造、快照缺大量原始时点、错误分类、超出完整行业容量、符号链接与命令行私有信息隔离。它们均为**合成协议测试**，不证明真实A股行情、合法授权、平台部署或已经形成任何收益样本。严格保留四套正式策略、15因子、模拟盘、云端配置以及两张锁定主页。