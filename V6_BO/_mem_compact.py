# -*- coding: utf-8 -*-
import io, os

TXT = u"""# 量化看盘平台 · 长期约定

根 `C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard`；本地 8787 = replica（不外发），线上 https://quant-dashboard-77614.app.workbuddy.host = primary。真实桌面 = `C:\\Users\\28957\\OneDrive\\Desktop`。

## 1 发布流程
`python _publish.py → --apply → 发布 → --restore → _post_publish.py`
- ⛔ **改完所有源码再跑第①步**（文件暂存进 `../stock-dashboard-artifacts/_deploy_tmp`，`--apply` 只拿暂存区铺根目录）。
- 没 `--apply` 直接发布 = 本地 config/access/业务数据冲掉线上；新建 .js 必进 `CODE_FILES`；`.kline_cache` 必随包。
- 清单：①`node --check` 全部 .js ②`_runall.js` 0 红 ③两端 APP_VER 一致 ④LF（`tr -cd '\\r' < f | wc -c` = 0）。
- ⛔ 升版本**按内容定位**（`l.startswith('const APP_VER = ')`），固定行号会打崩。**升完版本必须再跑一次全量回归**（版本注释里的旧字面量会让守门变红）。
- 收工：revoke 自己造的设备 → **重签并写回 config.json 的 syncUpstream.token** → 重启本地服务（启动时才读 config）→ `_test_sync.js`。⛔ **revoke 会 bump 世代号，同世代其它令牌跟着作废**（df 轮实测：撤 FPUBLISH01 后 FPUB_SYNC02 令牌当场失效，同步断）。安全顺序：先 `trust(fp=FPUB_SYNC02)` 重签 → 用它撤其余 → 复查 → 写回。

## 2 ⛔⛔⛔ 持仓铁律（用户当场纠正过两次）
- **线上持仓为空 = 用户自己删的**，禁止"还原/回补/拿本地补"。口诀：**线上空 = 意图，不是事故**。
- ⛔⛔ 查线上持仓**必须带 token**（不带被私密闸门挡 →「线上 0 条」是假象）；/api/state 的 paper 同理。token 走 query `?token=`，不是 Bearer。判口令只能打**线上 `/api/lock/trust`**（本地 8787 口令不同步）。
- 写操作记 `.holdings_ops.json` + 快照 `.holdings_bak/`（存**操作之前**的 items）。

## 3 判定与算法口径
- **涨停**：限幅按板块（主板10／创业30x·科创68x 20／北交所8·4·92x 30／主板ST 5，板块优先ST其次）。唯一写法 `A.isLimitUp(code,name,pct)`，禁 `pct>=9.8/9.4`。
- **命中 HIT_THR=3**：信号次日最高涨幅≥3%，全局引用禁写死。
- **结论必须自带前提（dd）**：`PROB_DEF` 定义概率赌哪件事（`ztToday`当日封板／`ztNext`次日封板／`up3Next`次日最高涨≥3%）；出口 `probDef/probTag/probDefOfType`；数值为 `null/'-'` 时连定义一起省；认不出类型宁可不写。⛔ `probDefOfType` 返回 **kind 键不是定义文本**（少套一层 `probDef` 会把 `ztToday` 印进推送，踩过）。规则：**盘中模块赌当日、收盘后模块赌次日**。资金数字必带窗口 `FLOW_WIN='当日累计'`（与「1分钟流入」差两个数量级）。参考止损 `STOP_REF_PCT=-3` 是**通用参考位**，与模拟盘真正执行的 `stopPct`(默认-8) 不是一回事 → 文案必带 `stopRefNote()`。
- **⛔⛔ 回验只认 `sig.nd`**（信号日收盘→次日最高）；`s.resolved` 是**信号当天**那根K线＝既成事实。唯一入口 `ndHit`/`ndLu`。⛔ 混用会**决策翻转**（similar 旧32%"不动" → 新61%"放宽多推"）。代价：nd 等次日、样本量降。`resolved` 只留两处：历史回测转换、`isPostHocSample`。
- **融合 fusedProb**：emp+la。实测按**原始**模型概率查档；自学 `(p-base)*100` 钳 ±12；`w=clamp(n/(n+120),0.35,0.75)`。govTake 内部算→所有调用点生效；文案用 **fuseLine**。刷新三处：resolveSignals→`_empCache.t=0`／runLearnallIngest→`_laCache=new Map()`／logSignal 存样本。
- **learnall v3**：读K线必须 `_pick()` 多名字段；17 维。改 DIMS 必升 VER 重灌。学了必须重排 `laAdj=(p-base)*100*0.8` 钳 [-7,+15]。
- **ztpre**：11 维前窗 + 线性累加 + calib{c,lam=0.4}；重建必须 `Z.ingestAll` 从空库。
- **趋势**：拆温和+强势两通道。唯一入口 `A.trendHygiene`(原始数据)+`A.trendVerdict(hg,channel)`；市值≥50亿（缺数据不拦）；强势**只**认 20 日内被砸 ≤-7%。⛔ 通道必须显式传。改判据前跑 `_diag_trend_channel.js`。
- **板块**：secOfStock 四层（涨停池→板块龙头→secStocks 反查→boardsOf 题材）。tooBroad(>40%涨停) 必须用于**榜单展示过滤**，否则"央国企改革"霸榜。
- **大单**：A.bigMoneyContext（下跌途中.25／深跌后.40／震荡.60／回踩.85／趋势中1.00）；风险修饰只打折不改名。缺K线按中性 0.7 不判死；≥500亿权重股最多 4 名额。
- **市场宽度**：`computeBreadth()` 全A真实涨跌；fakeGreen=指数>0 且（个股均值<0 或上涨占比<45%）。
- **技术指标**：calcKDJ/findFenxing/volPricePattern 在 analysis.js，经 trendScoreHint 并入 trendScore；算了必须在文案 why 尾部「｜技术指标」看得见。
- **新闻**：21:00 每日/周日汇总；就绪用 `newsReady()`；判定唯一入口 `newsIsBad()`；news.json 必须在 DATA_FILES。
- **数据源**：同花顺无龙虎榜（用东财 RPT_BILLBOARD_DAILYDETAILSBUY）；涨停池 reason_type 线上疑限流→双源回退东财；竞价分时东财 trends2 加 `iscr=1`；外部数据键用 `dataTradeDay()`。
- **⛔ 时间口径（cp）**：说「N 日」一律指**交易日**（`tradeDaysSince()`）。台账/留档/新闻归档/K线兜底按自然日合理（已核 13 处）。

## 4 推送口径
- 闸门=质量非数量：主闸门 pushMinProb(55)，额度(120) 只兜底，按质量降序。降噪：一轮合并1条≤4只／模块级30min节流／`modDayTake` 日上限（挂在**推送出口**不是 logSignal）。止损提醒绕过胜率门。必达清单走 **MSG_FREE_RE 免配额**。`pushAll` 返回 **false 只留给夜间静默**，⛔ 别当送达确认。
- 占位与送达原子：`govTake` 返回 `undo`，失败整批退回；出口截断 `govTrim(keep,N)`；空结果用 `modDayKeepOrDrop` 退名额；⛔ 已送达绝不退。MSG_TYPE_RE **命中即停**，长词先判。一次性闭锁写在推送**之后**。
- **幂等/重放（bt）**：实例每次发布都重启 → 11 个「每天只发一条」闭锁不许只活内存。判据 `pushedToday(titleRe)`（查落盘 pushlog.json，只认今天 + status 以 ✅ 开头；闸门/静默/副本拦截/发送失败一律不算已发）。启动用 `sentLockFromPushLog` 恢复。⛔ 闭锁变量**不许**声明在 `init()` 内。
- **两入口共用一把锁（bu）**：定时器自动发 + 面板手动补发必须共用同一闭锁与同一份文案（抽成函数，别整段抄）。
- **⛔⛔ 双实例权威（cq）**：一件事只能有一个权威实例，另一个**回拉展示**。副本闸门 `isReplica()` 覆盖推送/学习/保活/趋势扫描/**模拟盘**。同步转发只转面板手工操作（**自动成交看不见**）。转发配置必须剔除 `pushRole`（写成 replica=线上从此不推）与 `syncUpstream`（回环）。回拉三原则：启动链+周期轮询、busy 防重入、**拉不到绝不动本地**；成交流水按 `t|code|side` 归并。两机时钟偏差 ≈0.9 秒。
- **文案同源（br）**：一条消息的数字必须同一份快照（算结果时把口径定格进结果对象）。当日语义的快照必须带 date。
- **休市闸门**：所有推送入口都要 `isTradeDay(d)` 守门（`_test_holiday_push.js`）。
- **复盘每天必达**：15:30 起"直到发出"+闭锁；0~3 点不补推；重启 2min/8min 补发；首行 todayHead() 放"涨停几只+连板梯队+最高板+主线+封单最强"。
- **实测重标定 empcalib**：EMP_CHASE（追高）／EMP_EARLY（未启动）二分，漏族→掉"其它"。三级证据：常规≥20条跨≥5日／大样本≥150条跨≥3日／强证伪≥80条跨≥2日且实测比档中值低≥25点（单向）。
- **A/B 双推**：A=模型概率，B=实测档命中率（type='bigmoney-B'），hot 段 A4+B2，先截断再过闸。
- **私密标记**：`opts.private`=私密内容+改外发私密机器人；`opts.sseEdit`=只收窄 SSE 广播。⛔ pushAll 会把前 260 字广播给所有 SSE 连接，打标记不是可选项。

## 5 工程纪律（全是"不报错但悄悄错"型）
- **空值语义**：`marketReady()`=`(S.stocks||[]).length>0`；清空结果池一律 `if (marketReady()) S.xxx={items:[]}`。源头原则：**取到才覆盖**。
- **硬闸门不许把"判不出来"当"判了通过"**：`!!(x&&x.坏)`、`ago!=null&&ago<60`、`capOk!==false` 都是错法。缺数据只许在**打分权重**里按中性。
- **锁要对称**：`XBusy=true` 释放必须在 finally；guard 按名字加锁；单槽位复用锁只能清自己那一轮。
- **时间窗**：上午收盘=11:30；跨午夜区间 `start>end ? (m>=start||m<end) : (...)`。
- **写入端与校验端同一条规则**：先算后写；⛔ 不许在使用端偷偷改配置值。
- **配置量纲**：`CFG_RANGE` 管数值键（probThreshold 是 0~1，pushMinProb/pushMinProbPre/bigMoneyProbGate/simGate/bigMoneyPct/activePctThreshold 是 0~100），新增可调数值键必须登记；**`CFG_SET` 管开关/时段/小时数**（`auctionPreview`/`quietStart`/`quietEnd`/`viewIdleHours`，读取唯一入口 `cfgSetOf`，写入体检 `cfgSetErrors`，面板 `cfgSetState()`）。
- **外部参数边界**：revoke 拒绝空 id；字符串不许直接当对象键 → `_vpGet()`；整数 `_clampInt`；请求体封顶 8MB；口令上界 `PWD_MAXLEN=200`。
- **错误分支要回滚**：飞书队列 `st.running`（25s 看门狗+15s 超时，四条出口全走 done()）；授权码先签后烧；落盘失败要撤回内存改动。
- **异步 pending 有收尾**：秒回 `pending:true` 再后台跑重活，失败必须 `pushLog('❌…失败')`；失败时不许拿上次缓存当本次返回；前端轮询失败要停表+有次数上限。
- **基准日标注（bv）**：K线三池+精选池必须标"这份哪天的"：`basisOf()`→`basisLine()`/`basisTxt()`。⛔ 前端 `basisTxt`/`_pn` 是 const，必须定义在使用点之前（TDZ 静默中断整页渲染）。
- **模块间口径一致（bs）**：主集合的派生副本必须同一 tick 更新（中间不许夹 await）；多个消费者追到同一个源（`S.ztBySector`）。
- **落盘往返（ci）**：JSON 静默——Map/Set→{}、Infinity/NaN→null、undefined 消失、时间只剩 HH:MM:SS。①当日快照必须带日期（唯一构造 `mkReviewShell()`）②Map/Set 摊成数组再落盘。
- **只挂定时器不挂启动链**（犯三次）：computeBreadth/klineBackfill/scanTrendUniverse 启动后必须补跑。**静默失败**：savePaper/saveAccess/saveLearn 不得出现在空 catch 里。
- **报错建议必须可执行（by）**：不许指向不存在的面板入口（写之前去 index.html grep）；数字承诺必须与常量一致。
- **前后端字段不许分叉（cg）**：前端读 `s.xxx` 而 /api/state 没发 = 静默 undefined。扫描器 `_scan_concept.js`。
- **⛔⛔ 面板「承诺」必须由兑现方自己产出（de）**：周期与阈值全部常量化（`TICK_MS`/`SECTORS_ZT_MS`/`BIGMONEY_SCAN_MS`/`POOL_REBUILD_MS`/`HOLD_WATCH_MS`/`AUCTION_REFRESH_S`/`BUZHANG_PUSH_PROB`/`ZT_INFER_PUSH_PROB`），由 `panelNotes()` 一个出口下发，前端只读不写。配套两层前提：到线只是**入选**（还要过胜率门/条数闸门/模块节流，被拦下不补发）；刷新类承诺只在 9:15–15:40 数据窗口内成立。守门 `_test_promise.js`。
- **测试与生产数据隔离（cf）**：本机是 replica，写操作经 `syncUpstream` 转发线上 → **本机 ≠ 沙箱**。`/api/holdings` 每个写操作都要带 `_noSync:true`。⛔⛔ 测试清理只许删自己造的。签发令牌的套件跑完必须 revoke 自己那条；验证码测试只用假号 1763448734。
- 守门总榜 `_runall.js`（退出码非 0 一律标红／**零断言计红**；总断言数不升反降 = 有套件崩了）。新增套件必须进 `CODE_FILES`。

## 6 鉴权与只读
- 门禁只验 `checkToken`（不区分 view/edit）→ **每个写操作路由必须自己调 `requireEditor`/`isEditorReq`**。取凭证统一用 `req.__tok`（query 优先+body 兜底）。⛔ 别只从 body 读——前端 fetch 补丁只往 URL 拼。
- 写操作按模块分级样板：`/api/refresh` 的 RO_MODS/ED_MODS + `_want()`，只读点「全部刷新」自动降级。
- 自证入口（unlock/forgot/verify-code/reset-pwd/redeem/pending-status/trust/setup）必须在 8117 白名单内。
- 私密等级：**真实持仓 holdings ＝ 模拟盘账户 paper**，两个都要挡只读；`/api/state` 新增私密字段要按身份裁剪而不是整块隐藏。
- 令牌带世代号 {e|v}{gen}_hex.sig；`--apply` 写回线上 machineKey + accessAuth → 令牌跨发版存活。change(view) 密码没变→unchanged，不动 devices 不 bump 世代。
- ⛔⛔ 口令登录必须签发长期设备令牌（`unlock` 四条成功分支都 `issueDevice()` 回 `deviceToken`），否则实例回收→踢回登录页→走忘记密码→每轮一条验证码推送。
- ⛔⛔ `unlock` 里 `b` 是 try 内 `const b`（块级）：出 try 用 `b.name` = ReferenceError 打崩登录，`node --check` 查不出。必须外层声明 `_ufp/_unm`。
- 判口令用 `crypto.scryptSync(pwd,salt,32)`。找回密码 **绝不许踢自己设备**（仅 kick=true 才全网下线）。
- **授权台账真实只有 2 台**（用户手机+电脑，真实 fp=`F`+10~14 位随机小写字母数字；当前 Fwwdspvlsnjv4 / F4atcq2v3jdyu）。我脚本用可读 fp（FPUB_SYNC02/FPUBLISH01…）。每次 trust/unlock/发版都加记录 → **收工前 revoke 掉自己造的**（先删与当前令牌无关的，自己那条最后删；同一 fp 每次登录 id 都变，先查再删）。⛔ **必须留一条活着的同步身份**（FPUB_SYNC02）。只读 view 设备是用户给别人开的观看权，清理时避开。`/api/lock/revoke` 传 `{token,id}`，id 判 startsWith → 传完整 id。

## 7 工具陷阱
- ⛔⛔ **判代码一律用剥注释版本**（踩 10 次）：中文注释会逐字引用旧代码。用 `_codescan.js` 的 `stripNoise(SV,{keepStrings:true})`；括号配平用默认版本。
- ⛔ **不许用固定字符窗口/固定行号抠函数**（踩 9 次）：按花括号配对取真实函数体；配对前**先跳过形参表**与字符串里的花括号；`async function` 也要认。箭头函数 `x => {` 不能跳形参表。
- ⛔ **断言要钉语义不要钉字符串**（连踩 9 轮 br/bs/bt/ch/ci/cr…）。**把实现收成唯一构造/入口函数时，一定会有守门测试钉着旧字面量假红。**
- `stripNoise` 坑：默认连字符串一起抹→取字符串常量要 `keepStrings`；**正则字面量也会被抹**→生产代码尽量用 `indexOf`。**模板串长正文在 SV 里会被抹成空白**→判文案用原始 `src`。剥注释版把注释换成等长空格→固定字符窗口照样不够。
- 沙箱 `new Function` 注入清单漏一个外部符号（**含形参**、**含新增的下层 helper**）= 整个套件 ReferenceError 崩掉（不是变红），踩 14 次。空 catch 没注入表现为"产出 0 只不报错"。注入后**返回的是函数本身**，要再调一次才拿到结果。
- bash 双引号里写 `python -c`/`node -e` 时**反引号会被当命令替换**、**`\\s` 被吃掉** → 一律 Write 成临时 .js/.py 再跑。
- `node --check` 只查语法，查不出 ReferenceError/TDZ → 新变量必补真跑测试。前台 bash 默认 120s → 长等用 run_in_background。
- 沙箱替换 `new Date()` 时 **`Date.now()` 也要一起替换**；沙箱里 **git 子进程完全不可用**。
- ⛔ grep 时 `server.js:46` / `index.html:1420` 是超长版本注释行，会淹没结果 → 用 `awk -F: '$1!=46'` 过滤。

## 8 环境事实
- curl 本地 `--noproxy '*'`；socket hang up ≠ 限流 → `https.Agent({keepAlive:false,maxSockets:64,family:4})` + `Connection:close`。HTTP 响应可能带 gzip。
- 本地 8787 由 `start_daemon.py`（pythonw）守护，但**不一定自动拉起** → 手动：`pythonw start_daemon.py`，等 ~20s。线上实例被回收→冷启动；线上重启回退发布包→业务数据要打进包。
- 飞书 feishuq.js 队列串行（1200ms / 9499 退避）；大单重复流入 30min 节流 + 日 3 条/票。
- 前端：两端 APP_VER 必须一致否则无限 reload；禁行内尺寸；滚动容器 overflow-x:auto；禁 content-visibility。
- `/api/state` 有一份 **SSE 精简版**（键被裁剪，appVer 也不在里面）——查字段要打专用接口或抓首页 `const APP_VER`。

## 9 迭代流水（每轮换一个新角度，已查 55 轮）
⛔ 本节只留**仍会再犯的硬教训**；每轮来龙去脉与铁证写在各日日志（`2026-10-07.md` 等），别在这里堆历史。
- **df（20261007df）承诺了但没有任何一条路径会去兑现**：明写「嫌吵可在面板关掉」(`auctionPreview`)、「请检查面板的静默时段设置」、「可配 config.viewIdleHours」——而 index.html 零入口、`/api/config` 只认 `CFG_RANGE`（不在表里连 `_cfgIn` 都进不去 → 不报错不落盘、接口照样回 ok:true）、全项目零写入点。修法：`CFG_SET` 表 + `cfgSetOf` 唯一读取（⛔ **上界在读取端也要兜**，手改 config.json 拦不住）+ `cfgSetErrors`（先体检整批不写；⛔ **int 下界是 0 不是 min**，0=交回使用端解释）+ `cfgSetState()` 下发面板 + `quietWindow()` 静默时段唯一出口。⛔ 写「可在面板 X」前先问：表里有吗？面板读得到吗？接口收得下吗？守门 `_test_cfgset.js`(58)、扫描器 `_scan_deadswitch.js`/`_scan_df.js`。
- **de（20261007de）承诺 vs 兑现**：面板写死的周期/阈值与实现分叉（补涨龙同一面板两处 60% vs 75%、大单 2分钟 vs 1分钟、精选池 30分钟 vs 5分钟、竞价 12s vs 5s）→ 常量 + `panelNotes()` 单一出口。守门 `_test_promise.js`(41)。
- **dd（20261007dd）只有结论、没有前提**：①「涨停概率」盘中赌当日、收盘后赌次日 → `PROB_DEF`（**similar/buzhang 候选必须带 `type`**）②资金数字没窗口 → `FLOW_WIN` ③「参考止损」写死 -3% 而模拟盘执行 stopPct(-8) → `STOP_REF_PCT`+`stopRefNote()`。守门 `_test_premise.js`(45)。
- **dc（20261007dc）数量词指的是什么**：①「板块昨日 N 只涨停」盘中会换成今日 → `S.ztDay`+`ztDayTag()` ②「推送 N 只」实为条数 → 分列条/只 ③`dropped` **含** `lowProb` → `pushGovBlocked()` ④「共命中 N 只」按代码去重。守门 `_test_quantifier.js`(53)。
- **db/da 只在某一时刻成立的快照**：`S.stocks` 只在 `isDataWindow()` 内刷新 → 休市日冻在上一交易日收盘却仍按"今天"说。`S.stocksAt`+`quoteDayOf(at)`（⛔ 锚是拉取时刻不是"现在"）+`computeBreadth` 闸门；新鲜度**双判据**。
- **⛔⛔ 守门测试把持仓写进线上**：`_test_hold2.js` 按"PRE 里有没有"判该不该删，残留进下一轮 PRE → 永久跳过。修：按 `note:'__hold2_test__'` **标记**识别（绝不按代码删），处置三步（删线上 → **重发一次** → 复核）。
- **cz 两份账没人对过**：模拟盘 cash/positions 与 acc.trades 长期不对账。修法选**报告**而非**对齐**；⛔ 缺字段也判失败（账能算圆 ≠ 记录完整）。
- **cw** 只有一种输入会走到的分支／**cv** 说过一次就不再复核／**cs** 数据血缘／**cr** 同一概念两套系数／**cy** 回验只认 `sig.nd`／**cx** 占了名额却没结果要退还／**cc** 错误分支回滚／**cb** 外部参数边界。
- 两条死路别再走：**V8 覆盖率不可用**（129 套件全是沙箱 `new Function`）；**纯静态确证在本项目零命中**。真正有货的是**判据与场景的语义缺口**。
- ✅ 已核对成立的前提（别重复查）：`rows[length-1]` 当"最新一根"依赖 K 线日期升序（实测升序；最后一根未必是今天，另有 `dataTradeDay`/`kStale` 把关）。
- ⓘ 已知项不修：推送流水只留首行 40 字标题、正文不落盘（体积权衡）。

## 10 可迁移的通用教训
1. 同一个概念有两份"结果"时，先问"哪份才是我要预测的东西"。
2. 看到"只在一个入口里置位/置标记"就问"另一个入口呢"；同一段文案出现两次就抽成函数。
3. 系统里往往已有落盘的"做过没有"证据（流水/审计/ops），写判据前先找现成的持久化证据。
4. 加闸要问"在最需要它的场景下会不会恒走放行那一支"；收口时会有守门测试钉旧字面量假红 → **改判据不改实现**。
5. "不报错、不算错，只是短暂地自相矛盾"是本项目最典型的 bug 形态，静态看代码很正常。
6. 看到"两份都像是权威的记录"就问"谁拿它们对过账"。修法选**报告**而非**对齐**：自动对齐会删掉唯一的告警源。
7. 写反证断言前先想清楚新实现到底改变了哪个**可观测量**（cz 轮构造错了两次）。
8. **"跑之前快照、跑之后只删自己加的"在"上次没删干净"时必然失效** —— 要用**标记**而不是"在不在"界定归属。
9. 快照类数据的归属日，锚必须是**数据自己的产生时刻**，不是"现在"。
10. 判含正则字面量的代码**不能**用 `stripNoise(keepStrings)`；模板串长正文在 SV 里被抹成空白，判文案用原始 `src`。
11. **数量词是"数得没错、说的是错的"高发区**：①集合必须与所指对象同一次取回 ②一句话里两个数量词不许互相包含 ③"只/条/笔/家"不能混用。
12. 守门**不能钉"脏数据必须还在"**（脏数据被修掉后测试永远过不了 = 把守门改成纪念碑）；要钉语义并配一条反证。
13. `new Function` 注入后**返回的是函数本身**，要再调一次才拿到结果 —— 拿到函数对象时比较恒 false 且不报错。
14. 日期键先看清格式再切片：`breadth.json` 的键是**带连字符**的 `YYYY-MM-DD`，按 YYYYMMDD 切会得 Invalid Date → `getDay()` 是 NaN → 周末判定静默放行。
15. **凡是「一个数字 + 一个名词」的对外陈述，都要问"它成立的前提是什么、失效边界在哪"**。前提必须是**可复用的定义**（改口径只动一处）；认不出来宁可不写。
16. 涉及「类型 → 定义」的两层映射，写完立刻打一行沙箱输出确认拿到的是**定义文本**还是**内部代号键**。
17. 扫源码判定"某处有没有带某个调用"时，窗口要**前后都看**（定义常写在模板串前面几行），正则要覆盖所有同族名。
18. **写给人看的规则/周期/阈值是一份契约**：契约必须由**兑现方**自己产出，不能由展示方另抄一份。只能承诺「入选条件」，不能承诺「必然发生」。
19. 守门扫描面板文案时**必须先剔除 APP_VER 那行版本说明** —— 它逐字引用着本轮要消灭的旧字面量，不剔除就是「修好了反而永远红」。
20. **凡是"用户照着做就能达成"的提示（报错建议、注释里的「可在面板 X」），都要当成一条待兑现的路径去核对**：面板上有入口吗？接口收这个键吗？有没有写入点？三者缺一就是空头承诺 —— 而且它**不报错、不崩溃、面板照常显示**，只是那句话从头到尾是空的。
"""

targets = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md",
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md",
]
for t in targets:
    d = os.path.dirname(t)
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with io.open(t, "w", encoding="utf-8", newline="\n") as f:
        f.write(TXT)
    print(t, len(TXT), "chars")
