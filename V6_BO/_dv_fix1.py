# -*- coding: utf-8 -*-
# dv 轮：全量回归 8 条红灯 —— 4 处守门钉死旧字面量（改判据不改实现）+ 1 处沙箱漏注入
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    if old not in s:
        FAILS.append(tag + ' :: 没找到锚点')
        print('FAIL ' + tag + ' :: 没找到锚点')
        return
    if s.count(old) != 1:
        FAILS.append(tag + ' :: 锚点不唯一 (%d)' % s.count(old))
        print('FAIL ' + tag + ' :: 锚点不唯一 (%d)' % s.count(old))
        return
    s = s.replace(old, new)
    wr(path, s)
    print('OK   ' + tag)

# ── F1 _test_empcalib.js：沙箱漏注入 skipAdd（第 24 次同类坑）──
rep('_test_empcalib.js',
    "  grab('function empTable() {', '\\n}\\n'),",
    "  // ⛔ dv 轮：empTable 的出局分支现在调 skipAdd 计数 —— 沙箱漏注入 = ReferenceError 整个套件崩掉\n"
    "  grab('const SKIP_RULE = {', '\\n};'),\n"
    "  grab('const _skipTally = ', '\\n'),\n"
    "  grab('function skipAdd(kind, n) {', '\\n}\\n'),\n"
    "  grab('function empTable() {', '\\n}\\n'),",
    'F1 empcalib 注入 skipAdd')

# ── F2 _test_hindsight.js：钉死 `if (!isLiveSample(s)) continue;` ──
rep('_test_hindsight.js',
    "ok(/if \\(!isLiveSample\\(s\\)\\) continue;/.test(empBody), '⚠️ empTable 里有 isLiveSample 过滤（核心断言）');",
    "// ⛔ dv 轮：这一行被拆成「回测」「事后」两条**分别计数**的出局分支 —— isLiveSample 只返回\n"
    "//    true/false，看不出到底是哪一类被排除了（面板上永远分不清「还没回验」还是「按设计排除」）。\n"
    "//    断言改成钉语义：两类都必须有一条紧接 continue 的出局分支（中间只允许计数语句）。\n"
    "const _OUT_BACKTEST = /isBacktestSample\\(s\\)[\\s\\S]{0,80}?continue;/;\n"
    "const _OUT_POSTHOC = /isPostHocSample\\(s\\)[\\s\\S]{0,80}?continue;/;\n"
    "ok(_OUT_BACKTEST.test(empBody) && _OUT_POSTHOC.test(empBody),\n"
    "  '⚠️ empTable 里回测样本与事后样本各自出局（核心断言；dv 轮拆成两条分别计数）',\n"
    "  'backtest=' + _OUT_BACKTEST.test(empBody) + ' posthoc=' + _OUT_POSTHOC.test(empBody));",
    'F2a hindsight 出局判据改语义')

rep('_test_hindsight.js',
    "const broken = block.replace('if (!isLiveSample(s)) continue;', '');",
    "// 同上：反证构造也要跟着拆成两条（否则 replace 不命中 = 破坏版根本没破坏）\n"
    "const broken = block.replace(/if \\(isBacktestSample\\(s\\)\\)[\\s\\S]*?continue;/, '')\n"
    "                    .replace(/if \\(isPostHocSample\\(s\\)\\)[\\s\\S]*?continue;/, '');",
    'F2b hindsight 反证构造')

# ── F3 _test_paper_money.js：取块结束标记钉死 `... continue;` ──
rep('_test_paper_money.js',
    "const SRC_BUDGET = grabBlock('    const gross = Math.min(acc.cash', 'if (cost + fee > acc.cash) continue;');",
    "// ⛔ dv 轮：出局分支里插入了 skipAdd 计数 → 结束标记与断言都改成钉语义（判定式 → continue）\n"
    "const SRC_BUDGET = grabBlock('    const gross = Math.min(acc.cash', \"buyOverCash'); continue; }\");",
    'F3a paper_money 取块尾')

rep('_test_paper_money.js',
    "ok('源码有兜底：cost + fee > 现金就跳过', /if \\(cost \\+ fee > acc\\.cash\\) continue;/.test(SRC_BUDGET));",
    "ok('源码有兜底：cost + fee > 现金就跳过', /if \\(cost \\+ fee > acc\\.cash\\)[\\s\\S]{0,60}?continue;/.test(SRC_BUDGET));",
    'F3b paper_money 兜底断言')

rep('_test_paper_money.js',
    "  'const key = \"pool\", pm = null;' // 源码片段里还引用了这两个，补上占位",
    "  'const skipAdd = function(){ return 0; };' // dv 轮：片段里的出局分支会计数，沙箱补个空实现\n"
    "  + 'const key = \"pool\", pm = null;' // 源码片段里还引用了这两个，补上占位",
    'F3c paper_money 沙箱补 skipAdd')

# ── F4 _test_trend_gate_parity.js：钉死 `...jumpy) continue;` ──
rep('_test_trend_gate_parity.js',
    "  ok('⛔ 体检放在【出局】位置（continue），不是只算出来给人看', /_hg\\.capOk === false \\|\\| _jv\\.jumpy\\) continue;/.test(bScan));\n"
    "  ok('⛔ 连涨路同上', /_hg\\.capOk === false \\|\\| _jv\\.jumpy\\) continue;/.test(bSteady));",
    "  // ⛔ dv 轮：出局分支里插入了 skipAdd 计数 → 钉语义：判定式之后 80 字符内必须出现 continue\n"
    "  const _OUT_RE = /_hg\\.capOk === false \\|\\| _jv\\.jumpy\\)[\\s\\S]{0,80}?continue;/;\n"
    "  ok('⛔ 体检放在【出局】位置（continue），不是只算出来给人看', _OUT_RE.test(bScan));\n"
    "  ok('⛔ 连涨路同上', _OUT_RE.test(bSteady));",
    'F4 trend_gate 出局位置改语义')

# ── F5 _test_data_cap.js：E4 反证用「now 往前推」在凌晨会跨到昨天 ──
rep('_test_data_cap.js',
    "  const fullToday = [];\n"
    "  for (let i = 0; i < cap; i++) fullToday.push({ ts: now - i * 60000 });   // 全在今天",
    "  // ⛔ 用「今天零点 + i 秒」而不是「now 往前推」：now 往前推 499 分钟在北京时间\n"
    "  //    00:00-08:19 之间会跨到昨天 —— 最老一条就不是今天了，判据反而返回 true，\n"
    "  //    这条反证会在每天凌晨静默失效（2026-10-08 00:29 首跑即红）。\n"
    "  const _d0 = new Date(); _d0.setHours(0, 0, 0, 0);\n"
    "  const fullToday = [];\n"
    "  for (let i = 0; i < cap; i++) fullToday.push({ ts: _d0.getTime() + i * 1000 });   // 全在今天",
    'F5 data_cap E4 反证跨天')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
