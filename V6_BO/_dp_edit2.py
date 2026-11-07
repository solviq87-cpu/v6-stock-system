# -*- coding: utf-8 -*-
# dp 轮改码 第 2 步：4 处 gap 构造走 numGap/numGapRaw，mainPct/turnover/zt90 统一走 numNeutral
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

REPS = [
    # ① 预选池：写死 10 → 真限幅；zt90 也走唯一出口
    ("""      zt90: c.zt90, sectorZT: 0, gap: 10 - Math.max(c.pct, 0),""",
     """      zt90: numNeutral('zt90', c.zt90), sectorZT: 0, gap: numGap(c.code, c.name, c.pct),""", 1),

    # ② 趋势票概率：gapToLimit 改可空版本（面板用 null 显示 '-'）
    ("""      const gapToLimit = +(A.limitPctOf(s.code, s.name) - s.pct).toFixed(1);""",
     """      const gapToLimit = numGapRaw(s.code, s.name, s.pct); // 面板/文案用：取不到是 null（显示 '-'），不编数""", 1),

    ("""        score: numNeutral('score', poolItem ? poolItem.score : null),
        mainPct: s.mainPct || 0,
        profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
        zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
        sectorZT: ztInSec, gap: gapToLimit,
        turnover: s.turnover || 0, inflowStreakMin: 0""",
     """        score: numNeutral('score', poolItem ? poolItem.score : null),
        mainPct: numNeutral('mainPct', s.mainPct),
        profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
        zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
        sectorZT: ztInSec, gap: numNeutral('gap', gapToLimit),
        turnover: numNeutral('turnover', s.turnover), inflowStreakMin: 0""", 1),

    # ③ 盘中后排补涨推送
    ("""        const lp = A.limitPctOf(s.code, s.name);
        const gap = lp - s.pct;""",
     """        const gap = numGapRaw(s.code, s.name, s.pct); // 取不到为 null，下面门槛显式排除""", 1),

    ("""          mainPct: s.mainPct || 0,
          profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
          zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
          sectorZT: ztInSector, gap,
          turnover: s.turnover || 0, inflowStreakMin: streakMin""",
     """          mainPct: numNeutral('mainPct', s.mainPct),
          profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
          zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
          sectorZT: ztInSector, gap: numNeutral('gap', gap),
          turnover: numNeutral('turnover', s.turnover), inflowStreakMin: streakMin""", 1),

    ("""        if (bullishIntent && probC > pushTh && gap > 0.2 && !(badHit && probC < 92)) {""",
     """        if (bullishIntent && probC > pushTh && gap != null && gap > 0.2 && !(badHit && probC < 92)) {""", 1),

    # ④ 大单流入明细
    ("""    const gapToLimit = +(A.limitPctOf(s.code, s.name) - s.pct).toFixed(1);""",
     """    const gapToLimit = numGapRaw(s.code, s.name, s.pct); // 面板/文案用：取不到是 null（显示 '-'），不编数""", 1),

    ("""      mainPct: mp,
      profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
      zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
      sectorZT: (() => { try { return sectorZTCountFor(s); } catch { return 0; } })(),
      gap: gapToLimit, turnover: s.turnover || 0, inflowStreakMin: 0""",
     """      mainPct: numNeutral('mainPct', mp),
      profitRatio: numNeutral('profitRatio', poolItem ? poolItem.profitRatio : null),
      zt90: numNeutral('zt90', poolItem ? poolItem.zt90 : null),
      sectorZT: (() => { try { return sectorZTCountFor(s); } catch { return 0; } })(),
      gap: numNeutral('gap', gapToLimit), turnover: numNeutral('turnover', s.turnover), inflowStreakMin: 0""", 1),

    # ⑤ 文案：距涨停 X% —— 取不到说 '-'，不显示 null/NaN
    ("""涨幅${(+x.pct).toFixed(2)}%未涨停（真买入非追板），模型${probDef('ztToday')}概率${x.prob}%、距涨停还有${x.gapToLimit}%` }""",
     """涨幅${(+x.pct).toFixed(2)}%未涨停（真买入非追板），模型${probDef('ztToday')}概率${x.prob}%、距涨停还有${x.gapToLimit != null ? x.gapToLimit + '%' : '-'}` }""", 1),

    ("""概率仅${x.prob}%）· 距涨停${x.gapToLimit}% · """,
     """概率仅${x.prob}%）· 距涨停${x.gapToLimit != null ? x.gapToLimit + '%' : '-'} · """, 1),

    ("""概率 <b>${x.prob}%</b> · 距涨停${x.gapToLimit}% · """,
     """概率 <b>${x.prob}%</b> · 距涨停${x.gapToLimit != null ? x.gapToLimit + '%' : '-'} · """, 1),
]

ok = 0
for i, (old, new, want) in enumerate(REPS):
    n = s.count(old)
    if n != want:
        print('FAIL step2 #%d: count=%d want=%d' % (i + 1, n, want))
        print('--- OLD ---'); print(old[:200]); sys.exit(1)
    s = s.replace(old, new, 1)
    ok += 1
    print('  repl #%d ok' % (i + 1))

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step2: %d/%d 处替换已写入' % (ok, len(REPS)))
