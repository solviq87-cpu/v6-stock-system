# V6 自动候选预注册：研究日期严格校验（2026-11-10）

## 问题

自动候选提案器从已封存的旧研究报告生成下一轮权重候选。此前仅用正则判断 `source.lastObservationDay` 的 `YYYY-MM-DD` 字形，且未明确要求 `latestFrozenDay` 是有效日期；例如 `2026-02-30` 或 `2026-99-99` 在某些组合下可通过字面比较，令无效研究日历参与预注册。

## 修正

- 仅接受严格有效的公历日期（检查时间解析及规范化往返）；包括闰年 2 月 29 日。
- 同时核对历史封存报告最后观察日期及当前冻结截止日期，保持 `lastObservationDay <= latestFrozenDay` 的原规则。
- 仅调整 `src/core/factor-shadow-candidate-proposer.js` 与对应离线回归。日期不合法时直接拒绝提案，不修改档案、不回填日历、不打开未来收益文件、不自动重试。
- 因该模块属于当前研究代码指纹范围，修复后**既有算法指纹不一致的预注册会按设计失效**；需保留旧档案审计、用新代码对新冻结信号重新按规则预注册，不能修改或伪造旧候选。

## 验证范围

```sh
cd V6_BO
node --check src/core/factor-shadow-candidate-proposer.js
node --test tests/factor-shadow-candidate-proposer.test.js
npm run check
npm test
```

GitHub Actions `verify` 和 `verify-web` 均成功且基线与最新 dev 兼容，才允许合并。此处只记录待验收命令；CI 未出结论前不得声明通过。

## 边界与回滚

不修改正式15因子权重、四套选股策略、模拟盘、账户、行情接口、锁定的电脑/手机主页或部署；本地SHA不能认证第三方来源与真实收益。回滚仅 revert 本PR合并提交，保留不可变私有试验和预注册账本，不以旧包覆盖最新 dev。
