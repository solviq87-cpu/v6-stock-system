# V6 20261106bm：权威账本报价原时点收口

## 基线与范围

唯一基线是用户上传的 V6_1069_full_20261106bl.zip，实测 SHA-256 为 60fc9ae84b3744275f4ccb899e97576475905ea68e885403d4ab3767055ee414，与用户交接一致。只在该包完整解压副本上续写。

## 发现并修复

1. `server.js:paperAuthorityQuotes` 原先把 `tick.t` 或 `S.stocksAt`（接收时间）作为权威账本报价的 timestamp，也把该时间传入风控 observedAt。bl 的 `paperPxFresh` 虽已有15秒原时点检查，这个写账投影仍丢失原始时间。本轮改为再次核验逐票来源、原时点、有限正价格及非只读标记；timestamp、quoteAt、riskContext.observedAt 使用同一个供应商原时点，tradeDate 根据该时点按上海日期计算。
2. 风控 marks 原先只按缓存收到后3分钟筛选。现在按供应商原时点15秒筛选；遍历整个执行缓存，所以不在全A列表中的持仓代码仍可提供有效估值。缺少合格估值保持缺失，交由已有风控规则保守拒绝，不拿收盘价填充。
3. ingestPx 保留 quoteSource 到执行缓存，并拒绝无穷价格、空白/非字符串来源与非正原时点。paperPxFresh 对缓存和全A备用也做相同的有限值及来源检查。
4. server.js、桌面入口、移动入口、service worker、app.js 五处应用/缓存版本同步 bm。

原始四套策略阈值、账户存档及交易历史、双端布局、本地/线上角色配置均未修改。全A缺原时点数据仍可用于原展示/研究。没有启动云端常驻服务、购买服务或接入券商。

## 验证入口

新增 `tests/paper-authority-quote-time.test.js` 六项行为测试：保留原时点与来源；拒绝旧/未知/未来/非整数/只读行情；接收时间不能刷新过期风险估值且池外持仓保留有效估值；15秒边界；过期缓存仅向新鲜全A原时点回退；无穷价格和异常来源被拒绝。

定向包括新测试及 paper-original-quote-time、quote-freshness-bj、six-photo-backups、legacy-authority-integration：36通过、0失败。`npm run check`通过。

初次新增测试因 VM 的 require 相对路径以 tests 目录解析而失败，已改为 createRequire(server.js)；产品门禁未放宽。初次定向使用默认 reporter 不是TAP，已显式指定 --test-reporter=tap 后验证完整性。最终日志为 `authority-quote-time-targeted-20261106bm.tap`。

全量与干净包验证以当前 CHAT_HANDOFF、TEST_REPORT 及对应 TAP/exit 为准。

## 仍待推进

- `paperPrices` 展示估值仍有池价/全A快照兜底，不能把展示收益认证为实时成交收益。
- 权威账本报价的成交量、昨收/涨跌停依据仍来自全A元数据；本轮仅收口执行价格与marks原时点，不认证量额、停牌信息同频或全部价格消费者。
- 研究、信号及风险展示等其他入口仍需逐路审核原时点；不能宣称已完成全链审计。
- 原220只监控上限、全市场持续实时、目标机网络/限频/许可、真实新闻和独立样本外概率、实际持仓闭环继续按原计划推进。
- 短信OTP、实体手机、长期云端、第二机器恢复及真实策略效果未现场验收。

## 运行

先读 AGENTS.md 与 integration/CHAT_HANDOFF.md。Node22.6+、Python3、Linux util-linux flock，机器学习解释器需可导入 sklearn/numpy：

```sh
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/authority-quote-time-full-20261106bm.tap
npm run check
npm start
```

本次测试不构成用户线上部署或真实供应商交易时段连续更新验收。测试数不能换算工程完成率。

## 最终发布核验

发布核验：主工程和从暂存ZIP解压的独立副本均1075通过、0失败/跳过/取消、退出0；两份TAP完整性核验通过。1090个JS/HTML/CSS/Python源码文件与独立副本逐字节一致；独立复测后仅补交接文档及日志。
