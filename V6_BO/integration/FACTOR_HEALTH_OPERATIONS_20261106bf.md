# 因子健康诊断 bf

唯一新增基线：V6_1015_full_20261106be.zip，SHA-256 1b95978fc107ef91d1761b7db6127cd4414a837e39a423a738f416ce1ae78826。沿用完整工程，不以旧包覆盖。

新增src/core/factor-health.js、scripts/factor-health.js。这里只完成因子健康诊断小项目，尚未实现生命周期注册器、自动晋级/停用、后台采集、HTTP或页面。原四套规则、扩展因子融合、账户与数据源门禁未改；四端缓存版本bf，双端布局保留。

## 命令

```bash
node scripts/factor-health.js freeze /safe/health-input.json /safe/new-health-baseline.json
node scripts/factor-health.js evaluate /safe/new-health-baseline.json /safe/current-factors.json /safe/new-health-report.json
```

每次发布到新文件，不覆盖已有文件。输入普通JSON上限8MiB；输入、输出及祖先路径的符号链接拒绝；先完整暂存/fsync，再以硬链接发布并同步目录。需有权访问的可信本地目录及支持fsync/link的文件系统；不承诺对恶意本地进程替换祖先目录免疫。此CLI不读网络、不调用Python、不写账户或因子包。

## 输入协议

冻结输入为：

```json
{
  "schemaVersion": 1,
  "feed": {"source": "fixture", "provider": "explicit-test", "datasetId": "synthetic-factors"},
  "factorIds": ["sector_heat"],
  "policy": {"maxAgeMs": 900000, "minValidSamples": 2, "minValidFraction": 0.75, "maxMeanShift": 10},
  "baseline": {
    "schemaVersion": 1,
    "feed": {"source": "fixture", "provider": "explicit-test", "datasetId": "synthetic-factors"},
    "asOf": 1767600000000,
    "rows": [
      {"symbol": "600000", "sectorHeatScore": 40, "factorEvidence": {"sectorHeatScore": {"source": "explicit-test", "timestamp": 1767600000000}}},
      {"symbol": "000001", "sectorHeatScore": 60, "factorEvidence": {"sectorHeatScore": {"source": "explicit-test", "timestamp": 1767600000000}}}
    ]
  }
}
```

以上仅合成格式示例，不是历史证券实测。真实输入需使用有权取得的实际数据，不得把fixture改标签冒充实盘。

feed.source只能imported/fixture/simulated，provider/datasetId非空且不超过200字符；冻结与后续诊断必须完全一致。factorIds为现有strategies/extended-factor-pack.json内的唯一ID子集，绑定原字段、分组、标签、完整因子包指纹和版本，不支持把四策略信号收益自动映射成因子质量。输入因子值沿用原0至100分，零分是有效分数，空值是缺失。

policy必须显式指定，冻结后复用：maxAgeMs为1至366天的整数毫秒，minValidSamples为1至500整数，minValidFraction为(0,1]，maxMeanShift为(0,100]分。阈值为研究者选择，不是经验认证推荐。

baseline及当前快照结构相同：schemaVersion=1、feed、asOf毫秒时点、rows为1至500条唯一六位symbol。只接毫秒数值时间戳，不解析字符串。每行使用原因子field（例如sectorHeatScore），factorEvidence[field]需source等于feed.provider、timestamp有效且不晚于快照、simulated不是true、mode不是simulation。基线asOf不能超过冻结时钟；当前asOf必须晚于frozenAt且不超过诊断实际时钟。未来证据不容忍一分钟偏差。未选因子、账户及SDK原始字段不写入冻结结果。

每个因子基线必须同时满足有效样本数量与覆盖率，否则拒绝冻结。当前数据不足仍输出诊断，不伪造正常结果。各股票最多记一种输入状态，优先级：missing、invalid-value、missing-evidence、simulated、source-mismatch、invalid-time、future、stale、valid。证据恰好达到maxAgeMs仍有效；超过才过期。

## 结果语义

每因子有逐票samples状态、各状态counts、全股票分母sampleCount、validCount/validFraction以及仅有效样本的meanScore。零个有效样本meanScore=null；未满足数量或覆盖率则status=insufficient-data且meanShift=null。满足后才计算当前均值减基线均值，绝对值严格超过maxMeanShift为watch，其余within-thresholds；恰好等于门槛不报警。多个因子分别计算，不用另一个因子的样本补分母。

这只是两次横截面分数分布与输入质量诊断。股票池可以不同，样本池变动也会造成均值变化；没有用共同股票、行业中性化、显著性检验或滚动时序控制，所以watch不能解释为真实因子收益衰减、IC恶化、因果或该停用因子。无收益字段，不消费远期观察收益，不写主账户。生命周期与真实效果验证留待后续。

所有报告canTrade=false、verifiedLive=false、prospectiveCertified=false、weightsChanged=false，包括imported。哈希与重算用于发现文件意外改变，不是外部签名；操作者可以重建基线，不能证明事前盲样本、供应商真实、股票池完整或权限合规。改门槛应显式新建另一个冻结基线，保留旧报告，不称同一次冻结。

## 验证与后续

12项新测试涵盖分布漂移、缺失/坏值、逐票证据失效原因、覆盖率/数量边界、基线门禁、指纹与重算、时点/来源、独立因子分母、隐私投影、真实CLI不覆盖/符号链接/8MiB限制。合成夹具不证明真实效果；测试数不关闭生产验收。

下一项可做显式因子生命周期注册器（历史修订、权限、研究状态流转，不自动改策略），或be远期观察的自动信号采集/只读页面。逐票完整证据卡、财务筛查、ETF映射仍待；未购买/部署/接真实券商、CMR或多模型网关。数据源真实接通与许可、旧server网络范围审核、新闻/概率/仓位闭环与六类现场验收仍待。
