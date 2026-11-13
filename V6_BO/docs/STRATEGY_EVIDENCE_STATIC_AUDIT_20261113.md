# V6 策略证据真实性：2026-11-13 静态审计与下一批验收

> 本文仅记录当前 dev 的只读代码审计。未执行测试、未改变生产策略或账户、未合并 PR。后续实施前须重新核对 dev 与 #182、#185 的精确 SHA，避免覆盖并行开发。

## 已核实文件（dev blob SHA）
- `src/core/strategy-engine.js`: `ef5fd9ad31bdc9d7a0d66eb86c2bf820f763fc72`。规则输入缺失及非法阈值已 fail-closed，不应重复声称该问题仍未修复。
- `src/core/multi-strategy-engine.js`: `df3c6997858c4d704cb56cff5e188d52f8aaa6c3`。含市场环境权重、风险扣分和多策略聚合。
- `src/strategy/snapshot-normalizer.js`: `27dc8aa7eb3548012930893ed023ca7d4c74e074`。
- `src/strategy/research-playbook-engine.js`: `c97d6abb8c38380511a5e7b174e1954ee9a81c0e`。已有10个研究战法，输出 autoTrade:false。
- `strategies/a-share-strategy-pack.json`: `aaab1d62217d8f37419fc9a205481e85c6619534`。当前包有 trend、momentum、breakout、quality、reversal 五个评分族；与旧生产四策略并非同一概念。

## 静态发现：待复现，不是已证实生产漏洞
1. **归一化的缺失值可能变成可评分的中性值**：`snapshot-normalizer.js` 将缺失的趋势、相对强度、资金、突破等评分默认到50或由其他派生值填充，且 `tradable` 缺失默认 true。规则引擎虽已拒绝缺失字段，但归一化后字段不再缺失。应验证证据来源与字段完整度是否阻止不可信候选通过。
2. **研究与可交易资格要严格分层**：`strategy-service.js` 中 `requireFeedValidation` 可在未设置 `enforceFeedGate` / `blockUntrustedCandidates` 时仅限制扩展因子证据，不强制阻断最终 pass。必须明确调用方是否按研究/盘后/实时交易用途选择模式。
3. **权重配置边界待验证**：`multi-strategy-engine.js` 的 `strategyWeight` 和 `regimeWeights` 数值转换允许负值，分母可能接近零；应为非法权重增加拒绝/隔离测试，不能直接改动旧生产分数。
4. **研究战法存在输入不足与不匹配语义混淆风险**：例如首板/一进二等依赖历史K线和外部评分，需测试当K线有效但其他必要输入不完整时是否始终返回 insufficient_data，不能把未知当作不匹配或匹配。

## 下一批最小测试矩阵
- 缺失、null、空串、布尔、NaN、0、有效数字：分别覆盖原始字段与归一化字段；真实零必须保留。
- 只有缺省派生评分、无原始来源的候选，不得冒充“已验证真实数据”的交易信号。
- `requireFeedValidation` 的 evidence-only、strict、strict-compat 三模式在陈旧、未知、模拟、来源不匹配时分别验证。
- 负权重、零权重、无限值、无效门槛和空规则不应制造通过或异常分数。
- 10个研究战法逐项覆盖 candidate / not_matched / insufficient_data；不写账户、不生成交易意图。
- 验证旧生产四策略、两张锁定主页字节不变；在独立分支完成单测、全量回归及 CI 后再提出合并。

## 合并与发布边界
- #185 明确依赖 #182；按实际最新 dev 比对后才能决定合并，不能把 #179/#180 的修复重复回灌。
- 不修改生产账户、通知、券商连接、云端部署或密钥；不覆盖权威历史账本。
- 本文仅是静态审计，不证明生产故障，也不声称任何新测试通过。
