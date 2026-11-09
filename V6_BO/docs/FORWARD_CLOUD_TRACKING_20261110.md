# V6 选股信号云端持续跟踪｜持久归档及权限只读展示（2026-11-10）

## 目标与真实完成边界

本批将上一轮已合并的 `forward-signal-observer` 及 `picks-followup` 接到可持续的服务端文件归档和已有选股接口。**不新建第二个选股首页，不修改手机/电脑首页；不改正式四策略权重、模拟盘和真实交易。**

只有以下条件全部满足，选股页才会显示冻结后的 1/5/20/60 交易日价格观察：

1. 一个**在信号发生时真实冻结**的 cohort JSON 已由既有 `scripts/forward-signals.js freeze` 或其他可信信号生产者保存。不能用今天的候选池反造上月买入信号。
2. 一个与冻结信号同源、未复权、含显式交易日历的完整价格快照 JSON 已由获授权的数据采集器**原子地**写入持久存储。文件声明 `source: "imported"` 只是输入协议，不代表交易所已认证。
3. 云端单实例工作进程使用本批 `tracking:once` 或 `tracking:watch` 成功生成经 SHA256 完整性校验的研究归档。
4. V6 主服务与研究进程挂载**同一个私有持久化卷**，并在主服务启动时通过环境变量显式指向该归档。

**尚未完成**：把 V6 真正的选股扫描结果自动转成可信冻结 cohort；免费行情生产者的长期授权、交易日历、公司行为全链路认证；WorkBuddy 的部署 API（文档目前 401）；云盘/持久卷实际安装和定时作业配置；真实 A 股数据与 iOS 真机/跨设备实际验收。没有这些条件，页面会保持“尚无冻结信号记录”，**不伪造收益**。不可把当前源代码合并等同于云端实盘运行。

## 接入方法（需先有授权真实输入、Linux/Node 22.6+、私有持久卷）

从 `V6_BO` 目录运行（请用绝对路径，以下是示意路径）：

```bash
npm run tracking:once -- /srv/v6-private/frozen-cohort.json /srv/v6-private/approved-market.json /srv/v6-private/forward/current.json

# 配置唯一的云端研究任务（行情快照必须由其他可信任务持续原子更新）
npm run tracking:watch -- /srv/v6-private/frozen-cohort.json /srv/v6-private/approved-market.json /srv/v6-private/forward/current.json --interval 60000

# 主V6服务启动前设置，仅允许服务端本机读取；不能使用 public/ 内路径
export V6_FORWARD_TRACKING_REPORT_FILE=/srv/v6-private/forward/current.json
npm start
```

- `current.json`、`forward-tracking-history/` 及锁文件均在私人卷。研究归档 0600 权限，历史归档不可变；单写者 `.lock` 防止多个进程并发写入，异常遗留锁**必须人工核对后**才能清理。
- 快照必须包含满足 `evaluateForward` 的完整历史日期、原始价格、零量/停牌标记、公司行为日期以及合规来源；不能把滚动快照缺失历史日线看成 0 收益。可用旧 `forward-signals.js freeze` 先冻结信号，但**只能在信号当时就冻结**。
- 同输入重复运行不更新 revision；较早快照、已观察收益改价、跨数据源、不同冻结信号指纹、归档损坏或符号链接一律拒绝覆盖。
- 版本历史形如 `forward-tracking-history/00000001-2026-11-09.json`。由八位修订号与快照日期组成。持久卷的容量、保留策略和跨机备份仍需实际配置。
- 服务端只在已有 `GET /api/quant-picks` 权限验证成功、JSON 结果可解析且包含有效股票时，把**与响应中可见股票代码匹配的报告**加入 `forwardTracking`。原权限拒绝、异源访问、响应异常或存储损坏均不泄露该报告；无配置时完全沿用原行为。
- 不开放外部写入 API、不新开匿名 GET、浏览器不拥有持久研究账本，也不依赖某台手机开着以维持跟踪。浏览器刷新不执行扫描、历史价格重算、交易或飞书推送。
- 报告中 `verifiedLive:false` / `canTrade:false` / `prospectiveCertified:false` 均保留。价格涨跌是未复权价格观察，不是含费率净收益；规则审核只做样本描述，无独立样本外证实，不能自动优化正式权重。

## 检查

```bash
node --test tests/forward-tracking-store.test.js tests/forward-tracking-http.test.js
npm run check
npm test
```

部署前再做：从一台手机、一台电脑分别读同一个云端候选；撤权后即清空候选和 K线；在重启/轮询/跨日、周末及失败行情输入时仍读到可恢复的旧证据但不声称实时，且验证云端持久化卷不在 `public/`；核验 WorkBuddy 官方部署写入授权与回执。未经此验收不能声称“已在国内服务器自动运行”。

## 回滚

本次仅新增研究目录和可选环境变量。若回滚，关闭 `tracking:watch`，取消 `V6_FORWARD_TRACKING_REPORT_FILE`，主服务只返回原 `/api/quant-picks` JSON；归档文件先备份不删，回退代码到本次 PR 合并前的 `32929ba4`。所有账户、模拟盘、正式策略均不需迁移。
