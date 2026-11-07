# -*- coding: utf-8 -*-
# dm 轮：守门测试被改动卡住 —— 一份是缺注入（真问题），两份是钉死旧字面量（改判据不改实现）
import io, sys

def edit(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new, tag in pairs:
        if s.count(old) != 1:
            print('FAIL[%s] %s count=%d' % (path, tag, s.count(old))); sys.exit(1)
        s = s.replace(old, new, 1); print('OK  %s :: %s' % (path, tag))
    io.open(path, 'w', encoding='utf-8', newline='').write(s)

# ── 1) _test_precover.js：两个沙箱都要带上 STALE 源码（staleMark 是新外部依赖）──
edit('_test_precover.js', [(
    u"  let newThrew = null;\n  try {",
    u"  // ⛔ dm 轮：staleMark 是 preBreakoutInner / computeBuZhang 的新外部依赖\n"
    u"  //    （数据源没回来时打「沿用上一次」标记）。漏注入 = 空 catch 吞掉 → 产出 0 只。\n"
    u"  const _sv = require('fs').readFileSync(__dirname + '/server.js', 'utf8');\n"
    u"  const _cut = (a, b) => { const i = _sv.indexOf(a), j = _sv.indexOf(b, i); return _sv.slice(i, j); };\n"
    u"  const STALE_SRC = _cut('const STALE_KIND = {', '// ─── 「失败」的说法登记表');\n"
    u"  let newThrew = null;\n  try {", 'precover 取 STALE_SRC'),
    (u"      `${BZ_SRC}\\n return computeBuZhang();`)",
     u"      `${STALE_SRC}\\n${BZ_SRC}\\n return computeBuZhang();`)", 'precover BZ 注入'),
    (u"    `${PRE_SRC}\\n return preBreakoutInner();`)",
     u"    `${STALE_SRC}\\n${PRE_SRC}\\n return preBreakoutInner();`)", 'precover PRE 注入')])

# ── 2) _test_empty_semantics.js：钉的是 `if (marketReady()) S.` 单行写法 ──
edit('_test_empty_semantics.js', [(
    u"""ok('守卫写法是「只有行情源就绪才清空」（而不是无条件清空）',
  (src.match(/if \\(marketReady\\(\\)\\) S\\./g) || []).length >= 7);""",
    u"""// ⛔ dm 轮改判据：原来钉 `if (marketReady()) S.` 的单行写法，这些分支改成 if/else 块后假红。
//    钉语义：**清空动作必须紧跟在 marketReady 判定之后**（允许带花括号）。
ok('守卫写法是「只有行情源就绪才清空」（而不是无条件清空）',
  (src.match(/if \\(marketReady\\(\\)\\)[\\s\\S]{0,4}S\\./g) || []).length >= 7,
  '实得 ' + (src.match(/if \\(marketReady\\(\\)\\)[\\s\\S]{0,4}S\\./g) || []).length);""",
    'empty_semantics 钉语义')])

# ── 3) _test_success.js：同样钉了 `marketReady()) S.` 单行 ──
edit('_test_success.js', [(
    u"""  const lines = SV.split('\\n');
  const emptyPools = lines.filter(l => l.indexOf('marketReady()) S.') >= 0 && l.indexOf('= {') >= 0);
  ok('找得到"清成空结果"的出口', emptyPools.length >= 4, '实得 ' + emptyPools.length);
  const noWhy = emptyPools.filter(l => l.indexOf('empty:') < 0);""",
    u"""  // ⛔ dm 轮改判据：原来按行找 `marketReady()) S.`（单行写法），改成 if/else 块后一行都找不到了。
  //    按【语句块】取：从 marketReady 判定起，到该对象赋值结束为止。
  const emptyPools = SV.match(/if \\(marketReady\\(\\)\\)[\\s\\S]{0,6}S\\.\\w+ = \\{[\\s\\S]{0,400}?\\}/g) || [];
  ok('找得到"清成空结果"的出口', emptyPools.length >= 4, '实得 ' + emptyPools.length);
  const noWhy = emptyPools.filter(l => l.indexOf('empty:') < 0);""",
    'success 钉语义')])
print('all done')
