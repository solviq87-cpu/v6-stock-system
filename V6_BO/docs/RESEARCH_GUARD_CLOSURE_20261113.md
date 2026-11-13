# 旧研究候选门禁在当前主线收敛

开发基线为本地候选 `a3a6c9f40fd11dbdbf9fc348cc0f5d798d5f9a47`（dev `60a74c6` 加已经独立验证的A1/A2）。这不代表A1/A2或本批已合入远端dev。本批逐项复核旧PR #159、#161、#162后移植仍缺失的行为，不合并其旧分支，也不改写任何既有研究档案。

## 已修复的三个边界

1. **恢复等待不豁免预登记**：`factor-shadow-worker.js`与`factor-shadow-evolution.js`只把`cooldown.phase=active`视为纯监控通路；历史完全没有`cooldown`对象的`paused-shadow-decay`封存警报按严格active兼容，有对象但缺少phase不享受豁免。`paused-shadow-cooldown`也可能携带`phase=recovered`，不能凭状态名绕过新候选预登记。合法active冷却监控仍能收集恢复证据，不消耗晋级试验预算。
2. **同日指纹不冒充多日隔离证据**：`market-feed-consensus`保留数据声明的`asOf`，没有用接收时间代替。`feed-discrepancy-quarantine`按不同日期统计门槛；同日不同文件指纹不增加独立日数；同日矛盾结论单独标记。旧无日期报告可见但不凑天数。分类仍是只读研究标签，不能选择真实供应商、修改实时价格或授予交易权限。
3. **候选日期是真实日历日期**：`factor-shadow-candidate-proposer`对封存报告最后观测日和最新冻结日都执行ISO日历回环校验，拒绝2月30日、无效月、零年等。合法闰日仍可用；完整SHA不使一个无效日期成为有效证据。

## 验证与限制

新增/增强的同一组测试在独立原基线检出上为67项中59通过、8失败；修复后加现有运行健康专项为74通过、0失败、0跳过。包含真实core/worker路径、active冷却继续工作、recovered等待时拒绝读取未封存H5、同日多指纹、冲突、旧无日期和非法日历。

```sh
cd V6_BO
node --test tests/factor-shadow-evolution.test.js tests/factor-shadow-candidate-proposer.test.js tests/feed-discrepancy-quarantine.test.js tests/market-feed-consensus.test.js tests/factor-shadow-runtime-health.test.js
```

日志在本次交付的`operations-gates-before.tap`、`operations-gates-after.tap`。本lane只跑定向和语法检查；全量与干净环境、集成和最终远端CI由主集成流程另报。测试为离线合成数据，未证明真实来源、收益、生产运行或前瞻性。

研究算法源文件指纹随本次变更改变。升级后新候选须按新代码重新预登记并等待真正新增的成熟信号；不能改旧注册指纹、删除旧试验或重复使用已看过的保留样本以绕过门禁。正式策略权重、账户资金、锁定主页和通知/部署均未改。

回滚只revert本批代码提交，不删除私有不可变候选/报告，也不从旧ZIP覆盖新主线；旧数据继续保留供审计，不能静默解释为新的未来候选。
