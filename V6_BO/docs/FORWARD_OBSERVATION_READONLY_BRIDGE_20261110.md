# V6 冻结信号观察报告：云端只读接入（2026-11-10）

## 范围与限制
- 后台 forward-signals.js freeze/evaluate 和 forward-signal-observer.js 的冻结证据流程不变；**本功能不自动生成信号、不拉新行情、不回测、不推送、不下单**。
- 为已经存在的 /api/quant-picks 编辑者 **GET** 响应增加可选 forwardTracking，供现有 /picks.html 展示 1/5/20/60 **交易日**的价格观察。未设置文件、报告不合规或普通观看权限：**不附加**此字段，客户端仍显示未知，而不是当作0%。
- 使用独立的只读报告文件；**报告不进 Git 仓库，不放到 public/ 下，不放个人仓位/券商凭证**。股票候选扫描的共享60秒缓存永远不能持有私有报告，响应通过对象浅拷贝附加，防止编辑者先访问后观看者读到残留报告。
- 现有编辑者鉴权和API跨设备令牌门禁沿用；请求字段不可指定报告路径。只读观看身份只看原先候选列表，不会看到本项信号冻结研究报告。

## 运维操作（仅在有真实授权数据和已经完成观察评估后执行）
1. 操作人员在安全目录使用既有 CLI：node scripts/forward-signals.js freeze [signals.json] [unique-cohort.json]，随后 node scripts/forward-signals.js evaluate [unique-cohort.json] [market.json] [unique-report.json]。输出不能覆盖已有文件；必须保留与原始证据关联。
2. 检查 feed.source 为 imported、feed.priceBasis 为 unadjusted、指纹字段、asOf、observedAt、4个固定交易日周期及缺价/公司行为状态。**SHA只代表一致性字段，不是交易所或供应商独立签名**。
3. 将评估后报告文件保存在应用服务用户可读、非公开静态目录的绝对路径（普通 JSON 文件，不使用软链；不得大于 1 MiB）。
4. 在**已经授权的**服务环境设置 V6_FORWARD_OBSERVATION_FILE=/private/observations/report-YYYYMMDD.json 并按平台既有流程安全重启或滚动发布。切换新报告须使用新的文件路径；旧报告只归档，不覆盖。**不要把路径或报告内容写入 Git、前端代码或分享群**。
5. 以编辑权限打开 /picks.html，选真实候选后观察。未冻结或未成熟仅显示待观察/未知。普通观看权限访问同一云端不返回 forwardTracking。

## 拒绝条件
非绝对路径、软链（包括路径中的软链目录）、静态目录内文件、缺失/损坏/超过 1 MiB、来源为 fixture/simulated、非法指纹/时间/负价/错误周期/公司行为状态、与核心评估器协议不符等，全部拒绝并降级为“没有可核实跟踪记录”。

**仍未实现**：自动冻结实时信号、自动按交易日历评估、自动发布新报告、外部来源独立认证、公司行为完整性审计、真实手机Safari和WorkBuddy线上部署。这些需要单独授权及真实证据。报告展示的未复权毛价格变化不等于可成交净收益、胜率或策略有效性认证。

## 回归与回滚
- node --test tests/forward-observation-readonly.test.js tests/picks-followup.test.js
- npm run check && npm test、隔离HTTP冒烟与多屏Chromium CI。
- 回滚只移除 forward-observation-readonly.js 和 server.js 对该辅助函数的引用，清除可选环境变量即可恢复原只读候选结果。两个用户锁定主页、旧四套策略、模拟账户均不能修改。
