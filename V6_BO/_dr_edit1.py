# -*- coding: utf-8 -*-
# dr 轮改码 第 1 步：建「百分点」单位登记表 + ppTxt 唯一出口，并把散落的三种写法统一
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

ANCHOR = 'function stateCut() {'

BLOCK = '''// ─── 百分点的对外说法（2026-10-07 dr 轮）─────────────────────────────────
// ⛔ 两个**百分比相减**得到的是**百分点（pp）**，不是百分比。
//    同一个「溢价 lift」在项目里曾有三种写法：`+5.2pp` / `+5.2点` / 裸 `+5.2` ——
//    最后一种最危险：用户读到「封板 62%（溢价 +5.2）」会以为那是 5.2%，
//    而 62% 与 5.2% 完全不是一回事（前者是概率，后者会被当成又一个百分比）。
//    「点」也有歧义：股民说「涨了 50 点」指的是**上证指数点位**，不是百分点。
//    ⛔ 判据：**凡是两个百分比相减得到的数，说出去必须带单位，且全项目同一个单位（pp）**。
const NUM_UNIT = {
  lift:  { label: '溢价',     unit: 'pp', why: '封板概率 − 基准概率' },
  delta: { label: '自学修正', unit: 'pp', why: '自学概率 − 模型原值' },
  gapPp: { label: '证伪差',   unit: 'pp', why: '期望命中率 − 实测命中率' },
  gap:   { label: '实测差',   unit: 'pp', why: '模型期望 − 实测命中率' }
};
// 唯一出口：v 为 null/undefined/非数字 → '-'（不许显示成 0pp 冒充"没有差距"）
// opt.signed=false 时不带正号（前面已有「低/高」这类方向词的场合用）
function ppTxt(v, signed) {
  if (v == null) return '-';                 // ⛔ 判空在转数字之前：Number(null)===0 会变成 "0pp"
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  const r = Math.round(n * 10) / 10;
  return (signed !== false && r > 0 ? '+' : '') + r + 'pp';
}
'''

REPS = [
    ('`强证伪(实测比模型低${gap}点)`', '`强证伪(实测比模型低${ppTxt(gap, false)})`', 1),
    ('`自学修正${out.delta >= 0 ? \'+\' : \'\'}${out.delta}点`', '`自学修正${ppTxt(out.delta)}`', 1),
    ('低${gapPp}点（仅跨', '低${ppTxt(gapPp, false)}（仅跨', 1),
    ('`，平均${avg >= 0 ? \'+\' : \'\'}${avg}点`', '`，平均${ppTxt(avg)}`', 1),
    ('溢价+${x.lift}pp', '溢价${ppTxt(x.lift)}', 1),
    ('封板${x.ztP}%（溢价${x.lift >= 0 ? \'+\' : \'\'}${x.lift}）', '封板${x.ztP}%（溢价${ppTxt(x.lift)}）', 1),
    # ⛔ 两处前缀不同（一处「，自学形态」、一处「 · 自学形态」）→ 用公共子串，want=2
    ('自学形态${_fz.delta > 0 ? \'+\' : \'\'}${_fz.delta}点', '自学形态${ppTxt(_fz.delta)}', 2),
]

n0 = s.count(ANCHOR)
if n0 != 1:
    print('FAIL step1a: anchor count = %d' % n0); sys.exit(1)
s = s.replace(ANCHOR, BLOCK + ANCHOR, 1)
print('  block ok')

for i, (o, nw, want) in enumerate(REPS):
    c = s.count(o)
    if c != want:
        print('FAIL repl #%d: count=%d want=%d' % (i + 1, c, want)); sys.exit(1)
    s = s.replace(o, nw)
    print('  repl #%d ok (%d)' % (i + 1, c))

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step1: NUM_UNIT + ppTxt 已写入，7 组写法已统一')
