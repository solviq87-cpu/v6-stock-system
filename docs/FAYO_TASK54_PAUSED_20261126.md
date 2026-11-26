# 任务 54 共享 worker 预算封存：已暂停，待最终验证

2026-11-26，用户要求保存当前成果并暂停本聊天全部后续开发。余项由其选定的统一接续聊天承担。本分支保留已实现且完成相关专项的任务 54 增量，未为交接强行合入主线。

- 本组原范围：37—42、48—58，共 17 项；主交接 [PR #356](https://github.com/solviq87-cpu/v6-stock-system/pull/356)。
- 分支：`fix/fayo-budget-continuation-20261126`。
- 开发起点：`fd3caeeef55b1cad63be14764a47e11a695c0b2e`；dev 基线 `b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。
- 本分支未包含主交付后续 `ba4f2703715e58e676c62decbbe521731d073703`，接续时按增量合入，不能整文件覆盖原 PR 的资金/历史修复。
- 状态：**相关专项通过，未完成最终独立复核、整合后全量或浏览器验证；未合入主 PR 或 dev。**

## 已实现的边界

原 9 处 worker 包装器可同时受理，独立声明的 V8 老生代上限合计 1984 MiB；隔离验证证明没有跨模块共享预算，没有据此声称发生了真实 OOM。

本增量在原包装器入口增加固定共享准入：后台最多 2 个 worker、合计 768 MiB 声明额度；高级账户风险读取独立 1 个、128 MiB，后台不能借用。类型由服务器代码固定，客户端不能指定 priority、类型或共享句柄；保留原互斥、读去重、有界队列、权限握手和超时，没有新建调度器或队列。

原 workspace→stock-observation 嵌套调用使用同一 SharedArrayBuffer；槽位 token 与 rootOwner 避免旧释放清掉新租约。父 worker 实际终止后回收遗留子租约；收到 message/error 不提前释放，terminate 拒绝时等待真实 exit，停止状态不确定则保留额度。内部传输字段在 worker 中消费后删除，不进入原输入哈希和研究档案。只读 stats 不含路径、账户、正文或句柄。

**768+128 MiB 仅是纳入 worker 的 V8 老生代声明额度，不是进程 RSS、ArrayBuffer、Python 子进程内存或 CPU 硬隔离保证。** 不同服务进程和主机之间的共享预算尚未实现。

## 文件清单

修改：

```text
V6_BO/src/server/adaptive-research-job.js
V6_BO/src/server/advanced-account-risk-job.js
V6_BO/src/server/decision-financial-cache.js
V6_BO/src/server/learning-runtime-job.js
V6_BO/src/server/linked-intelligence-job.js
V6_BO/src/server/public-factor-job.js
V6_BO/src/server/research-job.js
V6_BO/src/server/research-worker.js
V6_BO/src/server/research-workspace-job.js
V6_BO/src/server/stock-observation-job.js
```

新增 `V6_BO/src/server/worker-admission-budget.js`、`V6_BO/tests/worker-admission-budget.test.js`、`V6_BO/tests/worker-budget-jobs.test.js`。`research-worker.js` 仅增加内部预算字段消费所需的模块加载。

## 已完成的真实验证

暂停时最后已启动回归已结束：14 文件，**71 通过、0 失败、0 取消、0 跳过，13.354 秒**。在 V6_BO 下执行：

```bash
node --test tests/worker-admission-budget.test.js tests/worker-budget-jobs.test.js \
  tests/advanced-account-risk-job.test.js tests/advanced-account-risk-http.test.js \
  tests/advanced-account-risk-live.test.js tests/adaptive-research-worker.test.js \
  tests/decision-financial-cache.test.js tests/learning-runtime-http.test.js \
  tests/research-workspace-http.test.js tests/complete-development.test.js \
  tests/linked-market-intelligence.test.js tests/decision-feedback-http.test.js \
  tests/decision-plan-research.test.js tests/stock-observation-monitor.test.js
```

覆盖真实嵌套路径、父子线程终止后回收、5 个真实线程争同一剩余槽仅受理 1 个、原超时/error/exit/构造失败、未确认停止不释放、旧回调不可清新槽、权限与撤权、HTTP 零出站、拒绝时不建研究档案且原隔离账户字节/现金不变。`npm run check`（69 原生模块）、新增 helper/测试及研究入口语法、`git diff --check` 已通过。

首轮测试曾因计时器 mock 缺少 unref 失败 1 项；暂停前已修正测试夹具，相关 30 项及最终 71 项重跑通过，没有修改生产超时。专项不能代替最终全量。

## 尚待接续

1. `stats()` 尚未接到 server 的原运行诊断输出；任务 48 的追踪接线也仍是独立草稿。
2. 独立代码审查尚未收到最终结论；已有设计审查指出的父终止后子回调不运行问题已由 token/rootOwner 回收设计及专项覆盖，但仍需最终复核。
3. 尚未与主 PR 新预演/冻结预算/历史/备份改动组合验证，未运行组合后的全量和双端浏览器。
4. 生产负载、跨进程/跨主机、Python 子进程硬限制及生产双端时延未验证。

没有活动测试、主线合并或生产发布事务。代码已冻结待命；本分支不是部署批准，原唯一生产发布机制未改。
