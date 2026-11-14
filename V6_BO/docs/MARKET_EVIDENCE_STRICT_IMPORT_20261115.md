# V6 多源行情证据门禁补强（2026-11-15）

## 范围
基于 dev@550b7ea6deaabec3c47d4800078982be2c0aa625 的既有 89 路上游登记与双源核验，**只增量修改后台历史数据处理**，不修改锁定的电脑/手机主页、不改变策略权重、不接入付费数据、不启用真实交易。

## 关键缺口
旧 `compareMarketFeeds()` 允许旧版未知供应商 A/B 按数值做 **研究级** 比对（可保留兼容）；但是 `createMarketDataCenter({secondaryFile})` 只检查 `consensus=true` 就会写入历史，未知原始上游、未提供单位、成交额或双方采集时点时依然可能错误放行。

## 本次门禁
- 双源数值对比继续供离线研究使用，但 **只有登记过、确认为不同上游、同价口径、同时间可比、成交量单位均为 shares、逐日成交额均为实际 CNY 且全部存在**，才能通过具有 `secondaryFile` 的严格历史导入。导入时钟之前的采集时间不能伪造为实时证书，未来采集时点拒绝。
- 发现同一上游包装源、停牌标志矛盾、缺停牌字段（单边声明）、停牌却有成交量、价格或金额不一致：记录字段、日期、股票和源指纹，并拒绝覆盖历史。
- `evidenceQuality.evidenceCompletenessScore` 是 0–85（百分制刻度）的**研究证据完整度分数**，不是股票价格正确率、不等于交易所确认。保留 `verifiedExternal=false` / `canTrade=false` / `releaseReady=false`。缺单位/成交额/时点/身份时研究输出为 `incomplete-evidence`，冲突为 `quarantined-conflict`。
- 原完整 BaoStock EOD 研究桥同时明确声明 `priceAdjustment.mode=unadjusted`、`volumeUnit=shares`、`amountUnit=CNY`、`amountBasis=actual-unadjusted-turnover`，不变更任何原始行、不凭空填补缺失数据；历史归档按原不可覆盖规则，新格式须用新的新建路径保存。

## 验收
独立 CI job `multi-source-data-lineage` 已绑定新增测试（每次分支 push/PR 会触发）。同时须通过全量 `V6 CI` 的后端/网页构建、语法、回归、启动冒烟；失败不合并。

```bash
cd V6_BO
node --test tests/market-evidence-enforcement.test.js tests/market-feed-consensus.test.js tests/baostock-eod-research-bridge.test.js tests/market-data-center-e2e.test.js
npm run check
V6_MODEL_PYTHON=python3 V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

## 未获得的证明
未在本批实测交易所官方行情、授权使用范围、正式交易日历、公司行为 PIT 正确性和独立网络行情样本；程序性的“两个不同来源”也不等于两个独立交易所发布商。旧采集链路未提供可信份额/金额证据时**必须先补原始合法来源，不得人为填 0 或改名绕过门禁**。

回滚：合并前关闭 PR 即可；合并后用正常 Git revert 回滚提交，不覆盖账号、历史文件或既有工程。
