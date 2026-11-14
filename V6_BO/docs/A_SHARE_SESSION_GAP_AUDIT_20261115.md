# 天枢智策 V6 · 交易日缺口、停牌与同源遗漏审计（2026-11-15）

## 为什么做

多源数据**数值相同**不是完整历史：若东财与 BaoStock 都少了某个交易日，原始双源价格/成交额逐行核对仍可能报告 `comparison.consensus=true`。供应商也可能把停牌记录放在日K查询结果中；不得把停牌状态伪装成成交日线，也不得把缺日期当休市。

本批基线 `dev@d92794226362b2924cde5621d0c70943bb897488`，复用 V6 已记录的 `config/research-calendar-2026.json`（SSE/SZSE，2026年365个自然日、242个明确研究交易日），使用原 `readResearchCalendar()` 的来源哈希与首次观察时间门禁。原数据在2026-11-12首次观察，**不得倒填为2026年1月前已获证据**；不提供2027年或北交所默认交易日历，不根据“工作日”臆造法定开市。

参考原站：
- [上交所2026休市安排](https://www.sse.com.cn/disclosure/dealinstruc/closed/) / [上交所正式休市通知](https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml)；
- [深交所2026交易日历](https://investor.szse.cn/English/services/trading/calendar/index.html)；
- [BaoStock原始日K字段](https://github.com/zxygithub/baostock/blob/master/docs/pythonAPI.md)：`tradestatus=0` 表示停牌、`1` 正常交易，`volume` 单位股，`amount` 单位人民币元。该字段是**供应商自报状态，不是交易所逐票认证**。

## 新增执行代码

1. `src/core/a-share-session-coverage.js`
   - `partitionBaoStockRows`：逐行核对六位A股代码、来源市场、日期、`adjustflag=3`、`tradestatus`、原采集时间，停牌行必须为零/空成交股数与金额；缺时间/未来/重号/异股/正常有成交但声明停牌一律拒绝。
   - 将停牌源行单独保留为`providerDeclaredSuspensionDays`，**不生成 OHLC 价格、不设假的 volume=0 日K**。日K规范化模块继续只处理真正交易的行。
   - `auditDailySessionCoverage`：逐只股票把真实 bar 日期与官方研究日历中覆盖的开市日对齐，分别统计“有交易bar”“供应商声明停牌”“无原因缺交易日”“休市日出现行情bar”“零成交但无停牌证据”“停牌证据与已交易bar冲突”。输出来源、日历指纹和首次观察时点、按股票缺口，所有标志 `exchangeVerified=false / pointInTimeBacktestReady=false / canTrade=false`。
   - 日历无文件、来源时间晚于核查时刻、越过年度覆盖（2027）、不支持北交所等情况返回`calendar-unavailable`，绝不把星期一到星期五自行认作交易日。
2. `scripts/research-cross-source-history.js` 原有东财/BaoStock离线对账入口：
   - 只在保证原始 `provider=baostock`、严格分离原始停牌源证据后，使用正常交易日K做数值一致性核对；
   - 新增独立 `calendarCoverage`、`rawBaoStockFingerprint`、`excludedRawSuspensionRows`、`numericAndCalendarCoverageConsistent` 与 `researchEvidenceComplete`。后者还必须具备可比较的原采集时点、逐日停牌状态字段及原研究证据质量；**只要时间或状态缺证，即使日历和价格都匹配，仍为false**。**数值一致**与**交易日完整**明确分开；如果两家均漏开市日，`comparison.consensus=true` 也必须 `researchEvidenceComplete=false`。
   - 若确实有 BaoStock 原始停牌行，缺口可标为“供应商声明停牌但未经交易所证实”；即使所有缺口都有声明，仍不能把研究结果晋级实盘交易。
   - 文件只读导入，输出 `wx` 原子保护新路径，保持旧证据与历史报告不覆盖。
3. 新增专项 `tests/a-share-session-coverage.test.js` 和扩展 `tests/research-cross-source-history.test.js`，保留原回归。CI 新设 `a-share-session-data-quality` 每次 push/PR 真执行，覆盖共同遗漏、停牌原始状态、节假日、未来、日期错误、无采集时刻、异常金额和旧导入兼容。

## 运行与解释

```bash
cd V6_BO
node --test tests/a-share-session-coverage.test.js tests/research-cross-source-history.test.js \
 tests/research-calendar-source.test.js tests/multi-source-calendar-gate.test.js
node scripts/research-cross-source-history.js /path/Eastmoney-unadjusted.json /path/BaoStock-raw.json /path/NEW-report.json
```

报告可能出现：
- `comparison.consensus=true` + `calendarCoverage.status='unexplained-or-zero-volume-gaps'`：数值相同但开市日缺失，**不得称完整**。
- `calendarCoverage.status='provider-declared-halts-unverified'`：缺口对应 BaoStock 显式0状态，**非交易所认证**。
- `calendarCoverage.status='source-calendar-conflict'`：休市日有交易数据，或停牌日有成交；必须隔离。
- `calendarCoverage.status='calendar-unavailable'`：证据尚未提供/未到首次观察时刻/跨出年度，不允许使用猜测的工作日日历替代。
- `calendarCoverage.status='open-session-shape-consistent-unverified'`：观测日线日期形状符合已登记研究日历，但仍**不是**行情准确率、供应商授权、公布时点或可交易证明。

### 仍未解决及不得造假

- 真实逐票停复牌公告及确切生效时刻须由上交所/深交所或授权源再确认，BaoStock状态自身不证明完全正确。
- 公司行为（分红、送转、配股、除权）与财务公告需要逐事件原文、首次可知时点及复权因子证据。此模块**没有**自动认证公司行为，`corporateActionsVerified=false` 保持不变。
- 研究日历覆盖2026 SSE/SZSE且首次观察日期已记录，2027、北交所和更早日历需独立导入真实证据，不能把2026全年日历当作当时每日已知。
- 没有新增高频调用/数据购买、自动交易、推送、生产部署，也没有改变 V6 原四套策略、账户、持久化、15秒原始报价安全规则、锁定的电脑和手机两张主页。

回滚：以本批PR最终合并SHA做 `git revert`；不用旧zip替换新工程，不删除历史行情和账本。CI与生产网络的真实执行、供应商许可需按最终提交独立验证。
