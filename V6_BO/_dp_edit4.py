# -*- coding: utf-8 -*-
# dp 轮改码 第 4 步：
#   ① 登记 auctionScore（竞价分，与「技术评分」是两套语义，不许共用一条中性值说明）
#   ② 竞价分 → 涨停概率：取不到走中性，不许被压成基准 18%
#   ③ 模拟盘持仓快照：评分取不到不许拿**概率**冒充评分（两个 0~100 的数，语义完全不同）
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

REPS = [
    ("""  gap:         { label: '距涨停点数',   neutral: 8,  why: '⛔ gap=0 是「已封板」= 概率最高档，不能当兜底；全市场个股距涨停中位约 8~9 点' }
};""",
     """  gap:         { label: '距涨停点数',   neutral: 8,  why: '⛔ gap=0 是「已封板」= 概率最高档，不能当兜底；全市场个股距涨停中位约 8~9 点' },
  // ⛔ 与技术评分 `score` 是**两套语义**，虽然都是 0~100：技术评分是 K 线形态综合分，
  //    竞价分是集合竞价强弱分。混用一条中性值说明，等于默认两套分的分布一样。
  auctionScore: { label: '竞价分',      neutral: 50, why: '竞价分取不到走中位 50；原式直接当 0 分算，涨停概率被压到基准 18%' }
};""", 1),

    ("""    // 竞价分 → 涨停概率：黄金区+居前额+主力抢筹+板块效应 ≈ 60~70 分，对应涨停概率 55% 上下
    let prob = 18 + (x.score || 0) * 0.62;""",
     """    // 竞价分 → 涨停概率：黄金区+居前额+主力抢筹+板块效应 ≈ 60~70 分，对应涨停概率 55% 上下
    // ⛔ 取不到时原式当 0 分算 → prob = 18（几乎不可能推送）。0 分是「竞价最弱」的最差档，
    //    不是中性。走登记表的中性 50 → prob ≈ 49，符合「判不出来 ≠ 判了很差」。
    let prob = 18 + numNeutral('auctionScore', x.score) * 0.62;""", 1),

    ("""      buyTs: Date.now(), score: c.score || c.prob || 0, reason: reasonOf(c)""",
     """      // ⛔ 原式 `c.score || c.prob || 0` 有两处问题：
      //    ① `||` 链会跳过**真 0 分**（0 分是合法评分），退化成用概率顶替；
      //    ② 概率（次日涨停概率%）与评分（技术形态分）是两个 0~100 的数但**语义完全不同**，
      //       拿概率冒充评分写进持仓快照，等于把两件事记成一件。
      //    现在：评分取不到 → 中性值，不再借概率的壳。
      buyTs: Date.now(), score: c.score != null ? c.score : numNeutral('score', null), reason: reasonOf(c)""", 1),
]

for i, (o, nw, want) in enumerate(REPS):
    c = s.count(o)
    if c != want:
        print('FAIL step4 #%d: count=%d want=%d' % (i + 1, c, want)); sys.exit(1)
    s = s.replace(o, nw, 1)
    print('  repl #%d ok' % (i + 1))

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step4: auctionScore + 竞价分中性 + 持仓评分不再借概率的壳')
