# -*- coding: utf-8 -*-
# dc 轮：把 server.js / public/index.html 里的 APP_VER 提到 20261007dc
# ⛔ 按内容定位，不按行号（行号会漂，漂了就把别的代码行整行替换掉）
import io, sys

VER = '20261007dc'
NOTE = (
    "系统对外说的话里，那些「数量词」到底指的是什么（本轮新角度）。"
    "数量词长得像事实（一个整数），但“数的是哪个集合”从来没人追问 —— 本轮四处全是“数得没错、说的是错的”："
    "①「板块昨日 N 只涨停」：N 取自 S.ztBySector（当前涨停池）。竞价时段池子里装的确实是上一交易日收盘那批，"
    "“昨日”碰巧对；而盘中「补抓快照」那条路径重算竞价分时，池子已经换成今日的了 —— 同一行代码、同一句话，"
    "此刻说的是反的。更要命的是因子名「昨日板块涨停效应」进了学习库 S.learn.paths，inferZTProb 正按它的实测"
    "命中率回头去调概率 —— 名字说一件事、喂进去的是另一件。修法：涨停池是**按日期参数**拉的"
    "（fetchZTPool(lastTradeDay())），把那个参数原样记为 S.ztDay（不是拿“现在”去猜），新增 ztDayTag() 把归属日"
    "说成「今日 / 昨日 / 09-30」，认不出来就返回空串、宁可不说也不猜；buildZTRoleMap 把 secZTDay 与 secZT "
    "绑在一起带出去（数量词与它数的那批不许分开走）；因子名按归属日落两个键 —— 确认是今日的才开新键、"
    "昨日的继续落旧键，历史上几十条样本一条都不用迁移。"
    "②「今日推送 N 只」：N 是 PUSH_GOV.total，一条推送记一次、同票跨模块可占两次 —— 数的是条数、说的是只数；"
    "现在分列「N 条 · 覆盖 M 只票」。"
    "③「N 条因胜率不足被挡，另有 M 条重复/冷却被节流」：dropped 是全部被拦条数，lowProb 是它的**子集**，"
    "M 里含 N —— 读出来是 N+M，实际总共只有 M 条，同一批样本被数了两遍，还把“重复/冷却”的帽子错扣在胜率不足"
    "那批头上；而且 govResetIfNewDay 漏清 lowProb，所谓“今日 N 条”其实是进程启动以来的累计。现在出口统一"
    "pushGovBlocked()（throttled = dropped − lowProb，三数互不重叠）、换日连 lowProb 一起清零，面板 pushLog "
    "与推送脚注同读这一份。"
    "④「共命中 N 只」：INTRADAY 缓冲是 (类型:代码) 键，同一只票在「涨停」与「大单流入」里各占一条 —— N 是条数；"
    "现在先按代码去重再报，只数与条数分列。"
    "⛔ 通用教训：数量词的集合必须与它所指的那个对象同一次取回；一句话里两个数量词不许互相包含；"
    "“只/条/笔/家”不能混用 —— 混用就是两个不同的集合被当成了一个。"
    "守门 _test_quantifier.js（52 断言：沙箱真跑 ztDayTag 三种日子、auctionScoreOf 在两个归属日下产出不同文案与"
    "不同因子键、pushGovBlocked 三数互斥且钳位、govFoot 与 buildAlertsReport 全文案、govResetIfNewDay 换日清零，"
    "含 6 条反证）。｜上一版（db）：只在某一个时刻成立、换个时刻就错了的快照。"
)

LINE = "const APP_VER = '%s'; // %s：%s\n" % (VER, VER, NOTE)

for p in ['server.js', 'public/index.html']:
    with io.open(p, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = LINE
            hit += 1
    if hit != 1:
        print('!! %s 命中 %d 处（应为 1）' % (p, hit))
        sys.exit(1)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.writelines(lines)
    print('%s → %s (%d 处)' % (p, VER, hit))
