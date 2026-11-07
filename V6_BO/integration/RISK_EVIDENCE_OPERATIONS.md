# 显式风控证据导入（20261106an）

唯一起点是上传的746项、20261106am完整工程。本轮不更改四套策略规则、电脑手机布局，不运行history资金写入器，不连接真实券商。

## 导入

开发者 POST /api/research/order-account，或 `node scripts/paper-account.js <账户文件> <请求JSON文件>`。请求 action 为 `import-risk-evidence`，附 accountId（HTTP）、expectedRevision 和 evidence。副本禁止写，账户修订冲突拒绝，证据随权威账户原子保存，也随现有一致备份恢复。

行业示例（仅格式示例，非真实数据）：

```json
{"action":"import-risk-evidence","accountId":"pool","expectedRevision":2,"evidence":{"schemaVersion":1,"source":"imported","kind":"sector","version":"example-sector-1","provider":"fixture","sourceRecordId":"example-1","tradeDate":"2026-11-05","publishedAt":"2026-11-04T08:00:00Z","knownAt":"2026-11-04T08:01:00Z","classificationAsOf":"2026-11-04","sectors":{"600000":"example-sector"}}}
```

前收盘 evidence 的 kind 为 previous-close；公共来源、版本、tradeDate、publishedAt、knownAt 相同；内容字段为 observedThrough、priorEquity、priorPeak、previousEquity，分别表示截至交易日、该日账户收盘权益、此前峰值、再前一日权益。必须来自该账户的完整证据，不能把股票昨收价当作账户净值。

所有日期严格校验；时间必须含时区，publishedAt <= knownAt <= 当前时间，knownAt 不得晚于目标交易日上海时间末尾。行业分类不得晚于目标日。前收盘必须恰为日历中的上一交易日；无日历拒绝，不能只以“早于今天”代替。导入不代替正式供应商授权或数据真实性认证。

## 自动模拟消费

A/B自动提交在权威服务层强制 requireImportedEvidence。按目标交易日精确匹配，并以估值 observedAt 和服务当前时间为上界，选择 knownAt 最新的记录（同刻按导入顺序）。不复用前一天的日目标证据，不用当前行业反推历史；缺映射、缺权益、过期估值仍拒绝开仓。卖出减仓沿用原规则。成交使用实际成交日重新验证，跨日挂单不能沿用下单日证据。

显式研究 submit/fill 在账户存在导入证据后也使用导入证据，不允许内联乐观值覆盖；尚未导入的独立研究请求继续兼容旧显式riskContext接口。独立研究接口不是供应商认证入口。

同一 provider+kind+version 不能映射不同内容，完全相同的重导幂等。修订需新版本；同一日按knownAt选择，不因导入旧数据回退。每账户最多1000条，快照仍受20MiB限制；无自动清理/无限留存承诺。账户重置清除旧账户风险证据。成功委托和成交记录引用证据指纹；风控阈值拒绝审计保存引用及有界指标，导入前验证失败不会改账户。

## 仍待验收

本轮是人工显式导入和自动模拟路线消费，没有真实供应商自动抓取、认证或生产收益结论。真实行情、样本外、短信、真机、云端长期运行、跨机恢复仍待现场验收；云电脑未提供，未部署。SHA不是外部签名。

## 20261106ao：只读证据检查和冲突处理

新增 HTTP/CLI action=`risk-evidence-status`，附 query：`{"tradeDate":"2026-11-05","symbol":"600000"}`；可选 observedAt（毫秒），默认服务时钟。HTTP同样需要开发者权限；副本允许检查，禁止导入。检查不写账户、订单、审计，也不冻结资金。CLI没有交易日历时，前收盘所需日历仍明确报缺。

结果包含 accountRevision、policyVersion、evidenceReady 和 checks。每类证据有 required、ready、reasonCodes；成功时附 evidenceRefs，行业缺映射时列 missingSymbols，包含目标股票、现有持仓和未终结买单。未配置对应限制时 required=false；不是在证明供应商数据真实或全套交易条件可执行。

证据齐备不代表可下单：现金、冻结、价格、成交量、T+1、集中度、亏损阈值和新快照仍由真正提交/成交重查。检查返回的账户修订只反映检查时点，不是预授权或资金锁。

新增稳定原因码：MISSING_IMPORTED_SECTOR、MISSING_IMPORTED_PRIOR_CLOSE、INVALID_RISK_OBSERVATION、MISSING_SECTOR_CLASSIFICATION、MISSING_RISK_CALENDAR、RISK_CALENDAR_COVERAGE、STALE_PRIOR_CLOSE、AMBIGUOUS_IMPORTED_EVIDENCE。

时间戳必须是完整ISO日期+时分秒+显式时区（可带1至3位毫秒），拒绝2月30日、24时、宽松自然语言日期和省略秒。knownAt最新的同一时点若有不同内容，拒绝检查及开仓，不再按导入先后任意选供应商；仅键顺序不同的相同行业映射不冲突。需导入具有新版本及较晚knownAt的明确更正记录解决冲突。

账户reset/setInitial同时在archives保留原riskEvidence，新账户的riskEvidence为空，禁止旧净值或分类自动沿用。此行为只补证据保全，不改四套策略规则或历史资金写入器。

下一步仍需授权供应商真实数据与账户净值对账、自动日目标证据生产任务、长期运行性能和现场验收；不能用fixture替代。当前未接云电脑，未部署。

## 20261106ap：批量导入与只读预检

HTTP/CLI新增 action=preview-risk-evidence-import 和 import-risk-evidence-batch。字段为 expectedRevision、evidenceList（1至100条，公共HTTP另附accountId）；记录格式与单条导入一致。preview返回accountRevision、imported、unchanged、total、evidenceRefs、previewOnly=true，不写账户、审计或资金。副本允许预检，仍禁止导入；只读普通用户不能访问高级账户入口。

批量导入持有既有账户锁，在同一修订下完整校验所有行及20MiB上限；任一条格式/来源/时间/版本冲突，整组不写。成功新记录只增加一次账户修订；全组均已存在则不改修订。批内相同版本相同内容去重，不同内容冲突；行业映射键顺序归一化，避免同一内容因JSON顺序不同被误判。已有记录与批内新记录合计仍最多1000条。

示例请求：`{"accountId":"pool","action":"preview-risk-evidence-import","expectedRevision":12,"evidenceList":[行业证据对象,前收盘证据对象]}`，确认预检后将action改为import-risk-evidence-batch，使用同一个expectedRevision；若账户期间变化，必须重读并重新预检，不绕过版本冲突。示意的两个对象必须用真实完整JSON替换，不能直接执行占位文本。

预检只说明整组能通过导入校验，不是自动开仓许可，也不保证某天行业/前收盘证据齐备；导入后用risk-evidence-status按目标日检查。原单条import-risk-evidence兼容，内部共用整组事务。预检不校验整个审计存储的可写性，真正提交仍会执行审计和账户一致性检查。没有真实供应商自动抓取、来源认证或真实云端部署。

## 20261106aq：页面闭环、可见风控参数与运维CLI

### 电脑与手机操作

从原主面板或/m进入/research.html，使用原开发者凭据；高级账户权限不变，不增加访客权限。展开“模拟盘风控与权益”中的“行业与前收盘证据”，选择2MB以内、1至100条的JSON数组文件。先“预检文件”，看到当前账户的新增/重复数量后，才可“导入已预检证据”。导入后填写目标交易日和六位股票代码，“检查所需证据”。JSON结果展示缺失类型及原因码；证据齐备不是开仓许可。

预检绑定发起账户、凭据、文件对象及账户修订。换账户、改凭据或换文件均清除旧预检；导入无论成功或失败都消耗预检，不能用按钮重复放行。账户期间被后台更新时，服务器拒绝过期修订，界面不自动重读后绕过保护，需重新预检。文件不自动上传、不自动执行导入；后台不会因选择文件而产生交易。

风控表单新增“收盘回撤暂停”和“收盘单日亏损暂停”两个原后端参数。未刷新账户时，未填写字段不覆盖未展示的已有阈值；刷新后明确清空已显示字段表示停用该限制，仍需至少保留一项限制。其他隐藏策略参数随原配置保留，四套策略核心规则不改。

所有主账户异步操作（资金、审计、风控、结算、证据）固定使用开始时的账户和凭据，不会在读取完成后改向新选账户写入。迟到响应不覆盖新上下文。在途写入一旦发送不能当作已取消；如果凭据或上下文外部发生变化，应刷新原账户核对结果。操作中普通表单控件禁用，连点不重复提交。

### 文件运维CLI

```bash
node scripts/risk-evidence-import.js /opt/v6/data/order-accounts/pool.json /safe/evidence-array.json --expected-revision 12
node scripts/risk-evidence-import.js /opt/v6/data/order-accounts/pool.json /safe/evidence-array.json --expected-revision 12 --apply --expected-sha256 <上次预检返回的64位小写SHA256>
```

第一条默认只读预检，输出inputSHA256；第二条只有显式--apply且文件SHA256相同才导入。占位SHA256必须替换为真实值。两步均需明确expected-revision；文件或账户变化均拒绝，不自动重试、不自动升级修订。只接本地普通JSON数组文件，拒绝符号链接、非普通文件、2MiB以上、重复/未知选项。读取有2MiB硬边界，指纹针对实际读取的字节；即使只增添换行也须重新预检。

CLI返回有界计划及证据指纹，不输出整套账户资金明细或完整供应商原始payload；不抓取市场数据，不产生订单。导入后可继续通过已有paper-account CLI risk-evidence-status动作检查目标日；前收盘使用该动作时仍须提供足够覆盖的V6_TRADING_CALENDAR_FILE。

### 验证边界

本轮隔离浏览器启动真实本地服务、使用临时开发者和明确fixture证据，跑通页面到HTTP到权威快照。1536及390宽无body横溢、无未捕获JS错误；预检未改修订，导入只增加一次修订，资金不变/无订单，账户切换清除预检。不是实体手机、真实账户或供应商认证验证。独立VM测试覆盖迟到响应、令牌/账户/文件变化、重复点击及失败路径；真实子进程CLI覆盖SHA256、修订冲突和原子性。

下一步仍待真实供应商数据接入与日目标证据生产、账户权益对账和长期运行/现场验收。未购买云资源，未接真实券商，云电脑未提供，未部署。
