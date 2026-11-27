# ABCD统一验收第二阶段：C20四项原计划入口整改

基线#563 `7f2340fdc64f44eda8905c32cbf94d3f5e5a0b89` 原生全量7999/7999，30/30 CI作业通过，零失败零跳过。保留原#499十三项既有专项及五项审计脚本、原始提交 `e7089964c2563923b892c25adc88c5d4b67fca1a`。

## 本轮范围
当前卡明确不完整、缺失或无效几何、明确低于原毛赔率均拒绝；兼容旧内部无complete字段的数值合法计划。现价同时满足冻结与当前权威区间，止损或目标变化需重新冻结。复用原quoteUseEligibility要求canTrade=true；实际server.paperAuthorityQuotes已选择通过原门禁的原始行，本轮修复投影遗漏其权限字段，绝不赋予真实交易授权。原15秒、原2倍毛赔率生产者、账户权限、策略权重及成交路径不放宽。

新增C20四项正式node:test，原十三项全部保留；历史幂等夹具补原60项要求的交易日/成交时点，两个旧预检夹具仅补已核验原行权限，原断言保留。原报价投影测试增加一项。第五项C专项风险合同尚未批准及接入生产者，审计脚本仍非零；不冒称9项共享合同完成。

## 实测
直接加载精确V8原/改后adapter、原a-share-calendar、quote-observation-view、paper-input-provenance与原observer的dateOk/sessions。未用摘要/账本成交依赖为抛错桩，候选资格受控，买入回调仅sentinel计数；未写账户。8个通过预期的适配器场景（6反例+2正常对照），另1个未获批探针保留。原server投影片段验证合法行权限保留，5种缺失/异常/拒绝权限无执行报价。源码与测试语法通过。本地GitHub DNS不可用，新HEAD正式Node全量、HTTP与双端待CI，不移用原7999项。

```json
[
  {
    "name": "LATEST_CARD_INCOMPLETE",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "CURRENT_INTERVAL_DISAGREES",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "FROZEN_PROTECTION_REVISED",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "MISSING_EXPLICIT_QUOTE_PERMISSION",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "MALFORMED_QUOTE_PERMISSION",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "EXPLICIT_INCOMPLETE_RISK_REWARD",
    "expected": false,
    "before": true,
    "after": false
  },
  {
    "name": "NORMAL",
    "expected": true,
    "before": true,
    "after": true
  },
  {
    "name": "VALID_IN_RANGE_PRICE_MOVE",
    "expected": true,
    "before": true,
    "after": true
  },
  {
    "name": "UNAPPROVED_C_SPECIALIST_VETO",
    "expected": null,
    "before": true,
    "after": true
  }
]
```

现场、实际事务锁内复核、其他C跨组合同及dev保护仍待，不合并、不部署。
