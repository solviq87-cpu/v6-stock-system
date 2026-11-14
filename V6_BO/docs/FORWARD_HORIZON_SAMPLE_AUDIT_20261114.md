# 前向观察样本核对：按周期统计实际股票数

## 来源、范围与复现

延续既有开源评审 `OPEN_SOURCE_RESEARCH_20261107.md` 与
`integration/FORWARD_SIGNALS_OPERATIONS_20261106be.md`：参考 HARNESS 的远期观察思路，
沿用 V6 已有 1/5/20/60 交易日观察、冻结信号与私有归档，独立修复 V6 的统计消费。
本批没有移植第三方代码、安装量化框架、采购行情或调用模型 API。
QLib 官方[结果分析文档](https://qlib.readthedocs.io/en/latest/component/report.html)
区分标签/预测分析、基准以及成本前后结果；这里只作为评估口径的参考。
“至少 30 个观测、80% 成熟覆盖、10 只实际观测股票”是 V6 原有门槛及本批修正，
不是上游推荐阈值或经过市场校准的充分条件。

起始 `dev` 为 `e986fccf4282c3f5ccefa22c9f98372eadf74e68`。
开工已查询开放 PR：#210 为后台/报价/SSE，#4/#166/#169 为 UI 草稿；没有同模块活动 PR。
工作分支 `fix/forward-horizon-sample-audit-20261114`，任务 V6-009。
核对期间 #210 合并，已接到最新 `dev@92db2d2f64d130c21007915568d7292b14d9a0c4`；
仅交接/发布队列两份文档冲突，保留两批记录。业务模块没有冲突。

反例：同一只股票有 30 条不同信号，H1/H5 已有观测；另外 9 只股票刚产生信号，尚未到期。
原审核使用整个分组的股票数 10，让实际只有 1 只股票的 H1/H5 显示 `descriptive-only`。
缺价/停牌或未解决公司行为的股票也可同样抬高数量。

## 改动与兼容

- 每个周期独立统计 `distinctObservedSymbols`，只纳入该周期 `observed` 的股票；
  同股多个信号保留，但不同信号 ID 不增加股票数。不同策略/分组也不互借数量。
- 未观察窗口要求 `priceReturnPct:null`，拒绝 0、字符串、布尔或缺失值。
  缺价、公司行为继续进入成熟覆盖分母；待到期窗口继续单列，不算亏损或零收益。
- 新审核为 `schemaVersion:2`。原价格报告、冻结 cohort、跟踪快照的协议版本不变。
  `validateStoredForwardAudit` 按历史 v1 算法逐字段重算旧审核，同时检查当前输入契约；
  未知版本、伪造统计、完整性不符仍拒绝。
- `readSnapshot` 保留原 v1 审核与 SHA，读取不改文件。v1 的状态仅是当时历史统计，
  需要当前结论时重新运行 `forward-signals.js review`。
  跟踪器下一次成功处理同源输入会在锁内增加一个 v2 修订，即使行情指纹未变；
  再次处理恢复幂等。已固定的旧历史文件、原报价、原信号及其 SHA 全部保留。
- 所有 `readSnapshot` 业务消费者经核查均消费 `report`，不拿旧 `audit.status` 决定训练或交易。
  新审核仍为 `ruleEffectiveness:not-proven`，不改正式权重或模拟账户。

## 验证

7 项新测试在旧基线上 6 失败、1 通过；修复后关联专项 98/98 通过。
包含真实 review CLI、真实临时归档、旧快照读取、一次升级/重复运行、历史字节保持、
篡改后重新计算外层哈希仍拒绝、分组/周期隔离和 null 边界。
`tests/fixtures/forward-audit-v1.json` 是起始 SHA 的旧模块对合成输入真实生成的结果，
不是当前实现反算的预期值；输入构造位于 `tests/helpers/forward-audit-breadth.js`。

首次全量 3362 项中 3357 通过、2 失败、3 项可选 ML 缺失跳过；两项旧测试要求原
“不得附带收益/不能填零”错误说明，新的前置校验抢先抛出不同文案。
已统一错误含义，未改旧测试断言；关联 98 项重跑通过。
原基线最终全量 3362 项：3359 通过、0 失败、3 项可选 LightGBM/XGBoost 缺失跳过，TAP 完整性通过。
接入最新主线后，在本地提交 `45c3a3f8d8ec59a7b31998f2863522bea14dba1d`
（tree `736c987f30ba3d36d6f24222689065fd2f93f1ad`）执行完整回归：
3377 项，3374 通过、0 失败、3 项可选 LightGBM/XGBoost 缺失跳过，退出 0，TAP 完整性通过。
后续只更新这份说明及根交接文档，业务与测试代码不再变化。
语法检查、独立完整后端 HTTP 启动、网页构建/40 项测试/dist 一致性通过。
Python 历史归档 20 项、Windows 打包 12 项通过；14 来源目录、运行时依赖禁入、
发布结构离线检查通过。Node v24.22.1；复现命令：

```bash
RUNNER_TEMP=/tmp V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 \
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node V6_BO/scripts/verify-tap-completeness.js /path/to/full-integrated.tap
```

测试只用离线合成输入；未发生真实通知、实盘、生产发布或真实行情收益认证。

## 提交状态

已上传并创建 [PR #211](https://github.com/solviq87-cpu/v6-stock-system/pull/211)。
远端代码提交 `780dfdeb0fb536f02aa109454592ff398ac1d02f` 的 tree
`814320aed02e576b0f9a8d5f48e771c34011e5f6` 与本地 `c59a288` 完全一致，
实际 git fetch 后逐文件比较无差异；后续提交只更新上传回执文档。
PR head `1e52cb9` 的 [V6 CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43560732721) 已通过。已合入 `dev@4233950bab8182e05264792cc3e380d687c64bf8`。

历史阻塞：最初两次 `git push` 被自动审批拒绝。第二次已检索用户历史授权、核对公开仓库归属及
新增差异常见凭据格式，审批仍要求当前可信用户消息直接授权本次公开上传，
不接受助手或检索工具转述作为依据。没有换接口绕过拒绝。
2026-11-14 用户在当前对话明确“同意上传”，并授权处理本项目代码工作。
授权后审批通过，但命令行缺少 GitHub 登录凭据；使用已连接的 GitHub 服务成功上传
到同一公开仓库与独立分支。此成功回执取代先前“未上传”状态，不需要再次索取同一授权。

## 回滚

代码按本批提交 revert；保留所有历史，不删除或修改账户与冻结记录。
旧程序不能读取新的 v2 审核，因此回滚研究跟踪器前须停止它，将报告读取配置指向
已保留的、经过核验的旧 v1 历史快照；不要把 v2 文件改标为 v1 或覆盖原历史。
需要继续写入时使用独立私有跟踪目录，不能拿旧 current 覆盖新版已经成熟的记录。
线上后端、长期样本、目标 Windows 和手机真机仍属独立验收。
