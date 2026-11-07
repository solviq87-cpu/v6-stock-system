# -*- coding: utf-8 -*-
# dv 轮：把 MEMORY.md 精简重写（原 18.0KB 超限截断）+ 登记 dv 条目
import io, os, sys

PATHS = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory\MEMORY.md",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory\MEMORY.md",
]

NEW = u"""# 量化看盘平台 · 长期约定

根 `C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard`；本地 8787=replica（不外发），线上 https://quant-dashboard-77614.app.workbuddy.host =primary。桌面 `C:\\Users\\28957\\OneDrive\\Desktop`。口令 `Libao1314`。各轮铁证在日志 `2026-10-XX.md`，这里只留**硬约束+高频坑+指针**。

## 1 发布流程（严守）
`python _publish.py → --apply → 发布 → --restore → _post_publish.py`
- ⛔ 改完源码再跑①；没 `--apply` 发布 = 本地数据冲线上；新 .js 必进 CODE_FILES；`.kline_cache` 随包。
- 清单：①`node --check` 全部 .js ②`_runall.js` 0 红 ③两端 APP_VER 一致 ④LF（`tr -cd '\\r' < f|wc -c`=0）。
- ⛔ 升版本按内容定位 `l.startswith('const APP_VER = ')`；升完必须再跑全量回归。
- ⛔ APP_VER 格式被 6 套件钉死 `^\\d{8}[a-z]{2}$` → 补发只能同版本号。
- 收工：revoke 自己造的设备 → 重签 config.json 的 syncUpstream.token → 重启本地（等 40~70s）。
- 收尾回复必含：分享链接 + 加粗「前往「设置—数据管理—应用」中管理这个已发布的应用。」+ 下一轮角度。

## 2 ⛔⛔ 持仓铁律（用户当场纠正过两次）
- 线上持仓空 = 用户自己删的，禁止还原/回补/拿本地补。
- ⛔ 查线上持仓**必须带 token**（不带被私密闸门挡→「0 条」假象）；`/api/state` 的 paper 同理；token 走 query `?token=`；`unlock` 字段名 `password` 不是 `pwd`。
- 写操作记 `.holdings_ops.json` + 快照 `.holdings_bak/`。

## 3 判定与算法口径（唯一入口，细节见代码注释）
- 涨停 `A.isLimitUp(code,name,pct)`（主板10／创业30x·科创68x 20／北交所 30／主板ST 5）；距涨停 `A.limitPctOf`。禁 `pct>=9.8`。
- 命中 `HIT_THR=3`；结论自带前提 `PROB_DEF`（⛔ `probDefOfType` 返 kind 键）；资金 `FLOW_WIN='当日累计'`；止损基准 `stopRefNote()`。
- ⛔⛔ 回验只认 `sig.nd`（信号日收盘→次日最高）；`s.resolved` 是当天＝既成事实，混用决策翻转。
- 融合 `fusedProb`：实测按原始概率查档／自学 `(p-base)*100` 钳±12／`w=clamp(n/(n+120),.35,.75)`；文案 `fuseLine`。
- learnall v3（K线 `_pick()`／17维／改 DIMS 必升 VER 重灌）；ztpre（11维+calib{c,lam=0.4}／重建 `Z.ingestAll`）。
- 趋势 `A.trendHygiene`+`A.trendVerdict(hg,channel)`（⛔ 通道显式传）／市值≥50亿／强势只认 20 日内被砸≤-7%。
- 板块 `secOfStock` 四层 + tooBroad(>40%) 必须用于展示过滤；大单 `A.bigMoneyContext`。宽度 `computeBreadth()`。
- 新闻 `newsReady()`／`newsIsBad()`。数据源：东财龙虎榜 RPT_BILLBOARD_DAILYDETAILSBUY；竞价分时 trends2 加 `iscr=1`；外部数据键 `dataTradeDay()`。
- ⛔ 说「N 日」一律交易日（`tradeDaysSince()`）；台账／留档／归档／K线兜底按自然日。

## 4 推送口径（唯一入口）
- 闸门=质量非数量：pushMinProb(55) 主闸／额度 120 兜底／降序占名额。降噪：一轮合并1条≤4只／模块30min节流／`modDayTake`。
- 占位与送达原子：`govTake` 返 `undo`／`govTrim`／`modDayKeepOrDrop`；⛔ 已送达绝不退；闭锁写在推送**之后**。
- 幂等：`pushedToday(titleRe)` 查落盘 pushlog.json（今天+✅）+ `sentLockFromPushLog`；⛔ 闭锁变量不许在 init() 内；`pushLogCoversToday()` 先问证据够不够。
- 两入口一把锁：自动发 + 面板手动补发共用同一闭锁与同一文案（抽函数，别整段抄）。
- ⛔⛔ 双实例权威：`isReplica()` 覆盖推送／学习／保活／趋势扫描／**模拟盘**；同步转发只转面板手工操作；回拉三原则：启动链+周期、busy 防重入、拉不到绝不动本地。
- 文案同源（一条消息一份快照、当日快照必带 date）；休市所有入口 `isTradeDay(d)`；复盘必达（15:30 起直到发出／0~3点不补／重启 2min/8min 补发／首行 todayHead）。
- empcalib：EMP_CHASE／EMP_EARLY 二分 + 三级证据。A/B 双推：B=实测档命中率，hot 段 A4+B2。
- 私密 `opts.private`（私密机器人）／`opts.sseEdit`（只收窄 SSE）；⛔ pushAll 会把前 260 字广播给全部 SSE 连接。
- ⛔⛔ `pushAll` 返回 true≠送达（副本拦截／条数闸门／未配置都返 true）；真实结果 `_pushLast{ret,sent,why}`→`pushLast()`，登记 `PUSH_DONE`。

## 5 工程纪律（全是"不报错但悄悄错"型）
- **空值语义**：`marketReady()`=`(S.stocks||[]).length>0`；清空结果池一律 `if (marketReady())`；源头**取到才覆盖**。
- **⛔ 硬闸门不许把"判不出来"当"判了通过"**；缺数据只许在打分权重里按中性。兜底登记 `MISS_RULE`，唯一读 `missingOf`/`missKind`；没分的类型登记 `NO_SCORE_TYPES`。
- **⛔ 锁对称**（`XBusy` 释放必须在 finally）；**写入端与校验端同一条规则**。
- **配置两张表**：`CFG_RANGE`（probThreshold 是 0~1，pushMinProb 等是 0~100）+ `_govCfg(k)` 不收第二参数；`CFG_SET` 开关/时段，唯一读 `cfgSetOf`+`cfgSetErrors`（⛔ int 下界是 0）。⛔ null/空串=没配过不是 0。
- **落盘往返**：JSON 静默——Map/Set→{}、Infinity/NaN→null、undefined 消失。①当日快照必带日期（唯一 `mkReviewShell()`）②Map/Set 摊数组再落盘。
- **只挂定时器不挂启动链**（犯三次）：computeBreadth/klineBackfill/scanTrendUniverse 启动后必须补跑。**静默失败**：savePaper/saveAccess/saveLearn 不得在空 catch。
- **基准日标注**：K线三池+精选池必标"这份哪天的"（`basisOf()`→`basisLine()`）。⛔ 前端 `basisTxt`/`_pn` 是 const，必须定义在使用点之前（TDZ 静默中断整页）。
- **模块间口径**：主集合派生副本同一 tick 更新（中间不夹 await）；多个消费者追同源（`S.ztBySector`）。
- **⛔⛔ 面板「承诺」由兑现方自己产出**：周期与阈值常量化，`panelNotes()` 下发；只能承诺「入选条件」。
- **测试与生产隔离**：本机是 replica 会转线上 → **本机≠沙箱**；`/api/holdings` 写操作带 `_noSync:true`；⛔ 清理只许删自己造的；签发令牌的套件跑完必须 revoke 自己。
- 守门总榜 `_runall.js`（**总断言数不升反降=有套件崩了**）；新套件必进 CODE_FILES。

### 5.1 各轮登记表（每轮一个唯一出口）
di「够了」`NEED_RULE` ｜ dj「近N日」`WIN_RULE` ｜ dk「失败」`FAIL_RULE`+`TASK_RULE` ｜ dl「成功」`DONE_RULE`+`PUSH_DONE` ｜ dm 四出口 `STALE_KIND` ｜ dn 两个名字 `OUT_N` ｜ do 同键名 `STATE_CUT` ｜ dp 数被改几次 `NUM_NEUTRAL`+`numGap` ｜ dq 跨时间比 `PREV_SNAP` ｜ dr 两人眼里 `NUM_UNIT`/`ppTxt`+`signTxt` ｜ ds 走一圈后 `PROB_KIND` ｜ dt 舍入链 `paperTol(n)`+`paperBasisGap` ｜ du 截断归并 `DATA_CAP`/`dataCapOf`+`paperMergeTrades` ｜ **dv（最新）静默跳过 `SKIP_RULE`+`skipAdd`/`skipWhy`/`skipTop`/`skipState`+`empSkipStat`**
- **⛔⛔ dq**：凡存起来做差的必登记 `PREV_SNAP` 三出口（做差先验基线是否同一累计周期；`prev!=null` 挡不住跨天）。带窗口的差值必须交出实际窗口。⛔ 新增 /api/state 键必须同轮接线前端。
- **⛔⛔ dp**：取不到走 `numNeutral(key,raw)`；**profitRatio 中性 50（0=最差档）、gap 中性 8（0=已封板最高档），方向相反**。⛔ 判空在转数字之前。**送模型用中性兜底，说给人听保留 null 显 `-`**。
- **⛔⛔ dr**：两个百分比相减 = 百分点(pp)。**正负号与配色不许写死**：`signTxt`/`signNum` 唯一出口。脏文案由 `healSignArtifact()` 幂等清洗。
- **⛔⛔ ds**：`prob` 曾混装概率与评分 → `PROB_KIND`（pool/trend=score）+ `probKindOf`/`empKeysOf` 分流。⛔ 判定端 `probAt` 仍共用 55 门槛，已知未改。
- **⛔⛔ dt**：金额**两条链同一口径**（费用生成即舍、对账逐笔舍）；容差按笔数算 `paperTol(n)`；缺口由 `paperBasisGap` 定位 → `explained` 时不再建议重置。
- **⛔⛔ du**：容器容量集中登记 `DATA_CAP`+`dataCapOf`；归并唯一出口 `paperMergeTrades`（交出 added/dropped/dupDiff，去重键含 shares/amount）；裁笔落 `tradesDropped`；对账分「证据不全 `incomplete`」与「账记错了」；`pushedToday` 先问 `pushLogCoversToday()`。
- **⛔⛔ dv**：**跳过不是免费的** —— 每条 `continue` 都在改结论的分母。登记 `SKIP_RULE`（27 种原因），唯一出口 `skipAdd`（**未登记 kind 直接丢弃**）→ `skipState`/`empSkipStat` 交出「哪道判据跳了多少」。排除项与「还没回验」必须分开说。

## 6 鉴权与只读
- 门禁只验 checkToken → **每个写操作路由必须自己调 `requireEditor`/`isEditorReq`**；凭证统一 `req.__tok`（query 优先+body 兜底）。⛔ 别只从 body 读。
- 写操作分级样板：`/api/refresh` 的 RO_MODS/ED_MODS+`_want()`。自证入口（unlock/forgot/verify-code/reset-pwd/redeem/pending-status/trust/setup）必在 8117 白名单。
- 私密：真实持仓 holdings ＝ 模拟盘 paper，两个都挡只读；/api/state 新增私密字段按身份裁剪。
- 令牌带世代号 `{e|v}{gen}_hex.sig`；`--apply` 写回 machineKey → 跨发版存活。change(view) 密码没变→unchanged 不动 devices。
- ⛔⛔ 口令登录必签长期设备令牌（unlock 四个成功分支都 `issueDevice()`）。⛔⛔ `unlock` 里 `b` 是 try 内 const，出 try 用 `b.name` = ReferenceError 打崩登录 → 外层声明 `_ufp/_unm`。判口令 `crypto.scryptSync(pwd,salt,32)`。找回密码绝不许踢自己。
- **台账真实只有 2 台**（真机 fp=`F`+10~14 位随机串）。我脚本用可读 fp。每次 trust/unlock/发版都加记录 → 收工前 revoke 自己造的（先删无关的、自己那条最后删；同 fp 每次 id 都变，先查 id 再删；`revoke` 传 `{token,id}`）。⛔ 最后删自己 → 当前令牌失效 → 查询全空，要另起登录复核。只读 view 设备是用户给别人开的，避开。

## 7 工具陷阱
- ⛔⛔ **判代码一律用剥注释版本**（踩 11 次）：`_codescan.js` 的 `stripNoise(SV,{keepStrings:true})`；括号配平用默认版。升版本后 APP_VER 注释会逐字引用旧代码 → **必须排除 `const APP_VER = ` 那一行**。
- ⛔ **不许固定字符窗口/行号抠函数**（踩 9 次）：按花括号配对取真实函数体。守门套件自己也别用固定窗口。
- ⛔ **断言钉语义不钉字符串**（连踩 11 轮）；把实现收成唯一入口时守门必假红 → **改判据不改实现**。
- `stripNoise` 坑：默认连字符串一起抹（取常量要 keepStrings）；正则字面量也被抹；模板串长正文被抹（判文案用原始 src）。
- 沙箱 `new Function` 注入漏一个外部符号（**含形参**／**新增下层 helper**／**容器变量**）= **整个套件崩掉**（不是变红），踩 24 次。空 catch 没注入表现为"静默返回错值不报错"。注入后返回的是**函数本身**要再调一次。
- ⛔ **多步编辑脚本中途 FAIL 会整份不落盘** → 每步落盘或跑完立刻 grep 确认。
- bash 双引号里写 `python -c`/`node -e`：**反引号被当命令替换**、`\\s` 被吃掉 → 一律 Write 成临时 .js/.py 再跑。
- `node --check` 只查语法（查不出 ReferenceError/TDZ）→ 新变量必补真跑测试。前台 bash 默认 120s → 长等用 run_in_background。
- ⛔ grep 时 `server.js:46`／`index.html:1455` 是超长版本注释行会淹没结果 → 过滤掉。Edit 改中文文件可能整份 CRLF → 必校验。

## 8 环境事实
- curl 本地 `--noproxy '*'`；socket hang up≠限流 → `https.Agent({keepAlive:false,maxSockets:64,family:4})`+`Connection:close`。
- 本地 8787 由 `start_daemon.py`(pythonw) 守护但**不一定自动拉起** → 手动跑，等 40~60s。线上实例被回收→冷启动；线上重启回退发布包→业务数据要打进包。
- 前端：两端 APP_VER 一致否则无限 reload；禁行内尺寸；滚动容器 overflow-x:auto。
- ⛔ `/api/state` 不下发 appVer（查版本走 `/api/lock/status`）；`/api/state` 另有 SSE 精简版（键被裁剪）。

## 9 迭代流水（已查 62 轮，每轮换角度）
- ⓘ 已扫干净别再查六层（do）：S.xxx 赋值类型／313 函数返回值类型／state 66 键类型／4 文件落盘 JSON／time 语义／前端裸插值。
- ⓘ 键名债务（无消费者）：`pushGov.codes` 装数量；`peers[].n` 装股票名；`jumpy` 在 trendRej 是计数、在票对象是标志。
- 两条死路别再走：**V8 覆盖率不可用**；**纯静态确证零命中**。真正有货的是**判据与场景的语义缺口**。
- ⓘ 扫过但可接受：`prob||0` 15 处（保守方向）／前端二次 toFixed 9 处／11 个「上一次」缓存无一落盘。
- ⓘ 发版后线上核验才抓到过的存量：dr 轮 9 条旧文案 `+-1.7`（`healSignArtifact()` 自愈）→ **发版后要像扫 NaN 一样扫一眼线上真实输出**。
- **dt 轮**：金额舍入两条链不同口径 + 容差拍常数 → 费用生成即舍／对账逐笔舍／`paperTol(n)`；pool 的 116.38 元经 FIFO 配对定位为早期「两边都不含费」→ `explained`。详见 `2026-10-07.md`。
- **du 轮**：容器有上限 = 结论有边界。流水 300 上限 vs 对账全量重算（实测报 37.5 万假差额）；pushlog 500/500 撑着 11 个「今天已发」闭锁；同一个笔数曾有三个值（渲染 12／下发 30／对账全量）。详见 `2026-10-07.md`。
- **dv 轮（本轮）**：160 处 continue 里 **145 处完全静默**。实证：样本库 1959 条只有 368 条（18.8%）进实测档（缺次日口径 737／缺概率 242／回测 600／事后 12），histzt·pool·trend·zt 四类 1051 条**整类零存活**，而系统在任何地方都不说；paperBuy 五处 continue 静默 → 面板只说「暂无持仓」。修法见 §5.1 dv 行。详见 `2026-10-08.md`。
- **下一轮建议角度**：**「那些只有一半入口会走到的『补救』动作」** —— 系统里散着各种重试／补发／回填／自愈／兜底重算，重点查：① 补救动作有没有第二个人在跑（两个入口会不会各补一遍或都以为对方会补）② 补救失败后有没有第二次机会、会不会被自己的闭锁永久关掉 ③ 补救成功时有没有回头把「当时为什么需要补救」记下来（数据缺口的根因是不是从来没人看过）。

## 10 通用教训
1. 同一概念两份"结果"先问哪份才是要预测的；都像权威就问谁对过账（修法选**报告**不选**对齐**）。
2. 看到"只在一个入口置标记"就问另一个入口呢；同一段文案出现两次就抽函数；原则只落一半等于没落。
3. 系统里往往已有落盘的"做过没有"证据，写判据前先找现成的。
4. 加闸要问"最需要它的场景会不会恒走放行那支"；收口时守门钉旧字面量假红→**改判据不改实现**。
5. "不报错、不算错，只是短暂地自相矛盾"是本项目最典型 bug 形态。
6. 写反证断言前先想清新实现改变了哪个**可观测量**；清理用**标记**界定归属。
7. 判含正则的代码**不能**用 stripNoise(keepStrings)；判文案用原始 src；扫面板文案**先剔除 APP_VER 那行**。
8. `new Function` 漏一个符号（含形参、下层 helper、容器变量）= 套件崩掉不是变红；注入后返回的是**函数本身**。
9. 日期键先看清格式再切片（YYYY-MM-DD 按 YYYYMMDD 切→Invalid Date→周末判定静默放行）。
10. **凡是「一个数字+一个名词」的对外陈述都要问前提与失效边界**；只在日志里说的结论等于没说。
11. **数量词是"数得没错、说的是错的"高发区**：集合与所指同一次取回；"只/条/笔/家"不混用。
12. **看到「给个兜底值」先问是权重还是闸门**：权重可给中性值，闸门给任何值都等于替用户做了判断。
13. **⛔ 判空必须在转数字之前**：`Number(null)===0`、`|| 0` 又兜成 0，让"不知道"变成最好/最差档且不报错。
14. **⛔「取不到就给它一个值」先问两句**：在该字段里是什么档位；是要算还是要说（说出去就是编了一个数）。
15. **⛔ 拿「上一次的值」做差前先问它是哪一次的**：当日累计还是绝对值；差值窗口谁定的。
16. **⛔ 看到「一个光秃秃的数字」要问两句**：怎么来的（两个百分比相减是百分点）；相对什么。**正负号与配色不许写死**。
17. **⛔ 打通血缘前先问打通的是不是同一个东西**：0~100 的概率与评分数值范围重叠**不代表能进同一个桶**。⛔「取不到→补上」最容易只补通路不补语义。
18. **⛔ 改了"写出去的文案"要问磁盘上的旧文案走不走这道校验**：判据=幂等自愈+只改文案+挂启动链真调一次。
19. **⛔ 看到「对不上」先问两边是不是用同一把尺子算的**：放宽容差只是容忍差异，把口径统一才是修。
20. **⛔ 容差这类数不能拍**：必须随规模变化，并跟着结论一起说出来，否则没法复核。
21. **⛔ 对不上不等于记错了**：差额要能定位到具体哪几笔；定位不了就别给破坏性建议（重置不可逆）。
22. **⛔ backfill 会把旧口径的错固化成看起来完整的字段**：反推字段必须记住"它是推出来的"。
23. **⛔ 下「全量结论」之前必须先问「这份数据全不全」**：容器有上限 = 结论有边界，边界不说出来就会被当成不存在。⛔ **「证据不全」必须与「算错了」分开说**。
24. **⛔ 归并/去重要交出三个数**：added／dropped／dupDiff。只返回合并后的数组 = 被裁掉的与被跳过的都成了静默事件。
25. **⛔ 跳过不是免费的**：每条 `continue`/裸 return 都在改结论的分母。必须留下「为什么」（登记原因→计数→交出哪道判据跳了多少），否则「结果为什么这么少」永远无法自查；**「按设计排除」与「还没回验」必须分开说**。
26. **⛔ 构造「今天」的测试数据不许用「now 往前推 N 分钟」**：凌晨会跨到昨天（实测 00:29 跑 E4 反证静默失效、判据反而成立）。锚定「今天零点 + i」。
"""

for p in PATHS:
    d = os.path.dirname(p)
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(NEW)
    sz = os.path.getsize(p)
    with io.open(p, 'r', encoding='utf-8') as f:
        cr = f.read().count('\r')
    print('WROTE %s  %d bytes  CR=%d' % (p, sz, cr))
print('done')
