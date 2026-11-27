# 绯曜 FAYO D组第十批｜五项证券状态、海外财报、宏观及历史主数据门禁 · 2026-11-27

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。本批五个局部小任务，不代表五个D大项完整验收。关联 D22/D23/D26/D27/D30/D32/D35/D37/D40/D41/D60/D61/D63/D77/D78 局部；不声称新全球实时行情、解禁/质押、外汇/商品或退市接口已经连通。沿用现有唯一数据中心、权限、原数据、策略、账本与唯一发布机制。

## 五项整改
1. 证券状态证据：原分红及停牌公告的受支持代码与 SECUCODE 交易所后缀必须匹配，保留原响应和其他健康证据；未知及缺失字段仍保留，不据无公告推断正常交易。原计划中的未来停牌/复牌日期合法，不认定为已发生。
2. 证券状态采集时序：各并发报告和报价共享时钟高水位，原请求及收悉、发布采样均检查；无效或回拨后整批拒绝，不能因恢复将不可信批次升格。保持2并发、8请求、原35秒预算、无交易/通知权限。
3. SEC 公司财务事实：网络请求及直接历史投影均严格检查CIK、标签、单位、原申报日期、截至日和采集时钟，accession 必须原始字符串，不信任可强转数组。原申报日仍不是EDGAR受理精确时间，修订记录保留，不授予PIT或实时行情资格。
4. 世界银行宏观数据：直接投影重检请求国家、指标和年份范围；单页声明及可选页码/总数/页大小与返回一致，禁止隐式类型转换。输出实际返回年、已知数值年、显式null年及省略年份；不补零、不伪造缺口、不证明公布历史或交易授权。
5. 历史证券主数据：严格字符串股票身份、真实带时区民用日期及指纹类型；单股时点读取再次核查成员行；拒绝空、重复日期、身份不一致或无对应行情的主数据记录，保留原PIT状态、费率及公司行为校验，不改变复权执行门禁，不认证全历史市场覆盖。

## 测试证据
精确原 blob:
- V6_BO/src/core/public-stock-status-evidence.js: aa215e4e4ff202923c7b5ac520ee827cd8990317
- V6_BO/src/core/sec-companyfacts.js: 88219b07205326a3b87ffa3a8e0fc74cbd225f65
- V6_BO/src/core/worldbank-indicators.js: a1db12e210c6d2940ea718481d4818c54796e4fc
- V6_BO/src/core/historical-universe.js: a1f367eb6487efdef45f9a0cd382ffc328c23e86
原 SEC、World Bank 测试 blob 73d74925acfc55fc073d3996064267b1e603162b / f69ddce74d228463ca29944454bc06b0669a964c；原 trading-fees 与 historical-execution-price-basis 实际加载，未修改。
实际隔离 V8 执行精确原/修改后四个核心模块及正式 node:test 测试内容。采用同步/异步最小断言器、注入供应商响应、URL/Buffer/AbortController/stream/摘要/定时器/请求包装夹具；真实解析/投影/状态采集逻辑执行。未测真实字节哈希、原生 Node 调度、网络、文件归档或全量。新增 12 项修前 0/12，修后 12/12；原 SEC 与 World Bank 专项 12/12 通过。组合 24/24。详细修前失败：
- security status cannot accept the correct six digits with a contradictory exchange suffix: equal: expected false got true
- same-batch status capture rejects an intermediate clock rollback even after clock recovery: expected rejection /时钟/ got none
- invalid or throwing initial clock stops before transport, without a fabricated receipt: expected rejection /时钟/ got fixture clock
- direct SEC history projection validates typed identity, reporting cutoff and actual clock: expected exception /投影/ got none
- SEC raw accession and request identifiers cannot be coerced arrays: expected exception /凭据/ got none
- World Bank direct projector revalidates typed request and future data years: expected exception /不合法/ got World Bank响应代码、年份、数值或缺失值异常
- World Bank single-page metadata must match the actual response, not merely coerce to one: expected exception /分页/ got none
- World Bank coverage separates omitted years, explicit null and real zero: deepEqual mismatch
- historical membership must have real civil source dates and typed security identities: expected exception /股票池/ got none
- point-in-time lookup rechecks source date and eligibility even if caller skipped dataset validation: expected exception /股票池/ got none
- PIT coverage refuses empty, duplicated or orphaned history, without falsely claiming complete evidence: expected exception /行情|证券/ got none
- PIT fee and security-master invalid calendar clocks cannot backfill historical knowledge: expected exception /费率/ got none

## 总管协调
已检查 #427 两页与 #444/#447/#443/#449/#453/#454/#430/#407 相关路径，本批目标无重叠；#427、#422 已含 ECB，#410 包含历史融合，#444 包含历史复权执行边界，本批不覆盖。D22 限售解禁、质押、退市源及 D23 全球实时价格、D24 外汇商品的真实接通与权限仍待，不能以本批背景财务/宏观资料代替。完整分支/历史冲突及原全量回归待总管。#439修订头、#443/#447/#449/#453远端尚未完成验收。未合并、购买、启用新服务、真实联网、部署或发布。回退只撤销本独立补丁。
