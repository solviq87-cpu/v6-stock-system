# 私有研究归档与前瞻证据工具

本批将旧PR #160、#163、#164中尚未在当前主线出现的独立工具重基线到当前协议。它们不会联网、训练、调生产权重、通知或交易；不能把本地时钟与哈希当作外部真实时间认证。既有#176智能体、#177联动/记忆和#178运行健康不重复开发。

## 1. 影子研究归档只读核对

```sh
npm run factor:shadow:archive:audit -- /private/trusted-reference /private/candidate-backup
```

比较可信独立参考和候选备份/恢复目录，要求每份历史模型、拒绝试验、预登记回执逐字节保留；不能只保存最新已接受模型而丢掉已消耗保留集的试验。允许额外有效档案，但不允许缺失/改写原档；拒绝未知文件、符号链接、未完成写锁和扫描期间变化。#178可变WATCH心跳单独验证，不计作不可变训练历史，也不能掩盖空归档。

该工具只读，`ok`表示与所给参考逐字节对应，不证明参考本身真实、备份独立可信、文件系统快照/分布式锁有效或跨机恢复已演练。不会执行恢复、删除、重置预算。目录需在私有受控位置，先停实际写入者再取独立快照。

## 2. 全行业成员收盘基准不可覆盖冻结

```sh
npm run research:sector:close:freeze -- /private/candidate-YYYY-MM-DD.json /private/same-day-closes.json /private/frozen-cohorts
```

只接受当日16点前已封存的原候选及所有已排名行业的完整成员身份；按当前运行时钟在同日16:00–17:00冻结原始未复权收盘基准。报价须有同日原时点，不能带未来价格/收益、补缺失成员、用小样本冒充完整行业或从历史数据倒造当时冻结。历史更改候选/成员/价格会在重放中被拒绝。

私有目录0700、文件0600，不覆盖旧档；相同输入重复调用为幂等，变更输入不能覆盖。该CLI不提供任意回溯时间开关，测试中的时钟注入仅用于离线函数验证。输出仍为未认证研究基准，canTrain/canTrade/canNotify/autoPromotion均false。

## 3. 本地事前登记与后续质量复核

```sh
npm run research:sector:pair:register -- register /private/plan.json /private/receipt.json
npm run research:sector:pair:register -- preview /private/receipt.json /private/later-quality-evidence.json
npm run research:sector:pair:register -- publish /private/receipt.json /private/later-quality-evidence.json /private/review.json
```

首次计划锁定明确日历、预期信号日期、供应商/分类身份和质量阈值，必须早于首个预期交易日09:30；计划不能自选一个历史registeredAt。后续证据必须沿用锁定日历、样本计划、身份与阈值，缺档计覆盖损失，不能事后删日提升效果。输入读取拒绝符号链接并检查普通文件、体积和读取变化；输出目录0700/文件0600，回执和复核报告不可覆盖。

本地系统时钟和哈希不能防操作者整体删档重建、回拨时钟或独立证明前瞻性。输出明确externallyTimestampCertified/prospectiveCertified/independentlyAudited=false；不能用于训练、自动晋级或交易。

## 实测与回滚

```sh
cd V6_BO
node --test tests/factor-shadow-archive-audit.test.js tests/sector-h5-full-member-close-freeze.test.js tests/sector-provider-pair-rolling-quality.test.js
```

本lane上述37项通过、0失败、0跳过。覆盖丢拒绝试验/预登记、字节重排、篡改/链接/写锁、可变心跳、16点前后、缺成员/旧报价/未来字段、不可覆盖/幂等、事前登记、身份/阈值/日历改写、缺档和私有目录。一次初始权限测试受运行器umask影响，已显式chmod构造755反例后通过，原初始日志保留，不冒充产品缺陷。

全部为离线fixture；实际当日16点冻结、真实供应商/日历/成员许可、足够成熟H5样本、跨机灾备均未现场验证。全量及最终CI以主集成交付为准。

回滚revert本批新增工具/命令/测试，不删除用户已封存文件，不迁移旧档案指纹，不执行恢复，也不撤销#176/#177/#178或其他功能。根目录npm命令仅转发V6_BO对应CLI，不自动启动任何watch或定时任务。
