# V6 自动学习第十四阶段：值守心跳与只读健康检查

## 为什么加这层

第十三阶段的 `watch --require-prereg --auto-prereg` 可以按指定间隔自动接力，但“进程能启动”不等于“冻结信号及时更新、H5结果已成熟、试验还允许继续、模型真的升级”。本阶段将这些含义拆开，**绝不把心跳存在冒称服务进程当前存活、数据真实有效或研究成绩改善**。

所有改动仅限于影子因子研究代码。正式15因子权重、四套核心策略、真实账户、模拟盘及两张锁定主页均不变；不会自行购买接口或部署到中国大陆云端。

## 只读查询命令

```sh
cd V6_BO
node scripts/factor-shadow-worker.js health /private/manifest.json /private/shadow
```

- 强制使用 `mode=v6-forward-training-manifest` 的规范研究清单，并验证其完整性、封存特征及本地研究档案指纹；不接受旧的简化测试清单冒充运维清单。
- 只检查每个 `reportFile` 路径是否存在且为普通文件，**绝不打开 H5 成熟收益内容**；这不会消耗额外样本外试验，也不单凭存在断言已成熟/已认证供应商来源。真实研究运行仍受规范冻结回执和首份成熟H5追溯门禁约束。
- 输出最近清单内冻结信号日、距今**上海市场自然日历天数**、缺失H5路径数、最新历史接受模型与试验观察日、候选预注册是否存在、试验预算/冷却状态、运行心跳。
- 自然日龄达到7日只是需要人工检查（休市、节假日和数据中断均可能导致）；**不是A股法定交易日计数，更不能断言上游行情故障**。尚无新的研究证据时报告 `no-sealed-research-version` 或 `candidate-awaits-post-registration-signals`，不会伪造训练轮次。

## 值守心跳

只有显式启用的 `watch` 在真正完成/失败一轮研究检查后，才会在既有 `withResearchLock` 独占写入锁内更新一个**可覆盖的运行状态文件** `.shadow-worker-heartbeat.json`；它与不可覆盖的 `shadow-*.json` 模型、`prereg-*.json` 预注册及试验预算档案完全分离。

心跳包含本地观测时间、值守间隔、成功/错误状态、最后一个公开状态码及不含账户/数据内容的PID，校验SHA256、以私有0600临时文件原子替换。不会含密钥、报价或任何真实资金。它本身不用于学习、交易、回测或通过研究门禁。

- 没有记录：`watch-not-confirmed`，不推断在运行。
- 最近3个轮询周期（至少2分钟）内有记录：`recent-heartbeat-only-not-live-certified`，只说明近期发生过一次tick，不证明该PID仍存活。
- 超时：`watch-heartbeat-stale`，需排查工作进程、计划任务、权限和宿主机。
- 最近tick失败：`watch-tick-failed`，需查本地研究进程错误日志；为保护隐私，心跳仅保存通用错误码。
- H5路径缺失：`missing-research-evidence`；已试完90个研究信号日窗口的6次预算：`research-budget-paused`；处于衰减冷却：`research-decay-paused`。这些属于**研究状态**而非真实交易状态。

查询命令本身不建立独占研究写锁、不创建/修改研究数据、不产生候选、更不会打开未来价格报告。实际自动监控、微信/飞书消息推送和外部故障告警服务不在本批实现范围；要持续通知还需要额外运行外部已授权的监控调度。

## 验证

```sh
cd V6_BO
node --check src/core/factor-shadow-runtime-health.js
node --check scripts/factor-shadow-worker.js
node --test tests/factor-shadow-runtime-health.test.js tests/factor-shadow-evolution.test.js tests/factor-shadow-cli-canonical.test.js
npm run check
npm test
```

测试包括：无心跳、超时心跳、最近tick出错、未来/重复冻结日期、市场自然日龄警告、缺失H5、预算耗尽、冷却暂停、冻结候选待新信号、完整性被篡改、严格研究清单、只读查询不建立工作目录，以及`watch`成功/失败心跳不会动研究归档。

**未覆盖/仍待验收**：实际大陆云主机服务常驻、跨进程PID真实在线证明、法定A股节假日历、外部独立时间戳、成熟收益认证、持续报警通道、真实前瞻策略收益和失效后的运维恢复。与这些项目有关的状态不得写“已上线”。

回滚：Git revert 对应PR合并提交；不要覆盖或删除既有`shadow-*.json`及`prereg-*.json`私有研究历史。
