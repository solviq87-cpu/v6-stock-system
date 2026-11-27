# 绯曜 FAYO D组第七批｜五项历史日线与交易日证据整改 · 2026-11-27

精确基线 dev@0c45291d7156be8a1206f0bb272f3c719d5d2336。本批五个局部小任务，相关 D13/D25/D27/D30/D31/D32/D35/D37/D40/D45/D54/D60/D63/D77/D78（按原编号去重；不认定整项完成）。未改主线、交易账户、策略、发布机制、授权或采集频率；保留前六批 #431/#433/#436/#439/#441/#443 的精确头。

## 五个小任务与实际代码

1. 东财日线字段与手/股单位：只接受精确字符串证券身份、有限长度非负十进制字段；拒绝十六进制、指数、符号、空白等隐式强转。按十进制精确换算手为股（0.29手=29股），拒绝非整股和超安全整数；原成交额人民币元及真实零值不变。不是新增全市场覆盖证明。
2. 东财历史响应：复用原重定向策略，非HTTP 200、矛盾状态、隐藏重定向及声明超限在正文读取前拒绝；保留原流式字节上限、不跟随、不新增重试、不启用新服务。
3. 东财日线请求时钟与完成度：严格整数毫秒；原 validateImport 使用本次请求起始时点而不是事后 Date.now()。开始于15:10之前的同日日线不作为完成日K；此前交易日仍可导入。该时点是保守准入时钟，不伪造逐股接收或供应商原始时间。
4. BaoStock日线：支持显式审计时钟，原采集时间不得晚于审计；复用 assessDailyBarFinality，盘中采到的当日K不能在后续审计时升格。缺原始采集时间的旧历史继续作为未知时点研究，不能准入当日/未来日K。原始数据哈希、数据集ID构成、停牌处理及原单位不改。
5. BaoStock逐日交易/停牌序列：严格递增日期，拒绝缺采集时钟下的未来交易行；盘中状态不能解释完整交易日缺口，分割与直接输入停牌审计均检查原15:10完成度。合法日级停牌仍只做供应商自报状态，不生成虚构K线。原 research-cross-source-history CLI 将显式审计 now 传给归一化模块，保持统一时点。没有独立交易所确认或PIT回测放行。

## 基线、去重及测试证据

原精确 blob：
- src/core/eastmoney-historical-feed.js: a809320dd1544e9afbeebbf2ac272953ba19ea06
- src/core/baostock-historical-normalizer.js: 9f748831c3e97a071b40001beb1afbf709e280ff
- src/core/a-share-session-coverage.js: 68c612ace187980f42eb74c657ca6c674251a8c2
- scripts/research-cross-source-history.js: 845479d40a299cdf25a62ec966d8e9bc0b986820

实际在隔离V8 JavaScript执行器加载上述三个原核心模块和修后源码，加载精确 a-share-calendar、daily-turnover-sanity、public-quote-redirect-policy、historical-validation、historical-universe；从精确 market-data-center 原文件提取 validateImport（不改此函数）。真实数据集形状检查和日线完成度逻辑执行。正式新增测试采用 node:test/node:assert/strict；此次用最小同步/异步断言执行器及注入的 HTTP response、URL/Buffer/AbortController/定时器、crypto摘要桩、只读日历夹具（使用仓库原2026年日历sessions）；未调用的回测、公司行为、结算依赖只允许空输入或抛错。不验证真实SHA计算、文件读取、字节编码、超时执行或生产联网；不宣称原生 Node 完整回归。完整仓库 git ls-remote 实测 DNS 无法解析 github.com。

新增14项修前 1/14 通过、13失败，修后 14/14、0失败。修前失败清单：
- Eastmoney daily response identity must be the exact string security code — expected /代码/ got no error
- Eastmoney decimal fields reject coercible hex, exponent, sign and whitespace — expected /OHLCV|成交额/ got no error
- fractional lots convert exactly to integer shares, not binary float or rounded sub-shares — 公开日K线OHLCV或成交额异常: 600000
- Eastmoney history rejects hidden redirects and non-200 success before reading bytes — expected /HTTP|重定向/ got no error
- declared oversized daily response is refused before body read — expected /超过大小限制/ got 公开日K线结构或返回代码不一致: 600000
- Eastmoney history start clock is integer milliseconds, not an implicit Date conversion — expected /时钟/ got A股市场时间无效
- a request begun before 15:10 cannot admit its same-day daily bar during later processing — expected /15:10/ got no error
- BaoStock original intraday daily capture cannot be promoted by a later audit — expected /15:10/ got no error
- BaoStock missing collector time stays unknown and never admits same-day or future data — expected /采集时间|完成度/ got no error
- BaoStock rejects an invalid audit clock and collector observations after the audit — expected /时钟/ got no error
- BaoStock partition refuses out-of-order status rows and future trading rows without receipt time — expected /顺序|日期/ got no error
- daily trading and suspension rows require original same-day closing evidence — expected /15:10/ got no error
- a caller cannot bypass partition and explain a missing open day using an intraday halt claim — expected /15:10/ got no error
修后全部14项通过（无未执行的新增测试）。脚本传递 now 一行仍须真实CLI集成回归。原测试不删除、不改断言。未真实联网、购买、启用服务、消耗额度或写生产数据。

## 交接

已核对 #427 两页及 #430/#444/#445/#407/#410/#411/#418/#443 文件路径，本批目标未见重叠；其他开放/历史分支仍需总管完整冲突检查。#431/#433/#436 的 V6 CI 与 UI Browser Geometry 已成功，但 Commit Coverage 失败；#431 日志为 missing-smoke-status，其他失败原因尚待逐一查日志；#439 覆盖失败，其他远端流程尚待。保留原逐SHA冒烟和唯一发布机制，不绕过。
待精确远端头运行原 eastmoney-historical-feed、baostock-historical-normalizer、a-share-session-coverage、research-cross-source-history 及新增专项、完整CI/全量、双端、真实数据和5/20/60交易日验收。未合并、部署或正式发布。回退仅撤销本独立补丁，不覆盖原数据、原账本或证据。
