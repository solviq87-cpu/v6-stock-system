# -*- coding: utf-8 -*-
"""dg 轮：升级 _test_test_isolation.js 的判据 ——
原判据假设「任何写线上都是坏的」，但**清掉自己造的残留**是必要的（db 轮事故已证明）。
现在允许一个显式的 purgeRemote()，但把它的边界钉死：只删带标记的、先删后清流水、收尾才调。"""
import io

P = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\_test_test_isolation.js"
s = io.open(P, encoding='utf-8').read()

# ── 1 _noSync 扫描跳过 purgeRemote 内部 ───────────────────────────────────
A = """      const win = src.slice(m.index, m.index + 400);
      const direct = /_noSync:\\s*true/.test(win);"""
assert A in s, 'A 找不到'
B = """      // ⛔ dg 轮升级：purgeRemote() 是本套件**显式连线上清残留**的出口，它走的是线上直连，
      //    本来就没有 _noSync 的语义（_noSync 管的是"本机写操作要不要转发线上"）。
      //    但它必须受下面【远程清理边界】那几条更严的判据约束，不是开了个口子就算了。
      const prA = src.indexOf('async function purgeRemote');
      const prB = prA >= 0 ? src.indexOf('\\n}', prA) : -1;
      if (prA >= 0 && m.index > prA && m.index < prB) continue;
      const win = src.slice(m.index, m.index + 400);
      const direct = /_noSync:\\s*true/.test(win);"""
s = s.replace(A, B, 1)

# ── 2 purgeOps remote 扫描同样跳过 ────────────────────────────────────────
A2 = """      const win = src.slice(m.index, m.index + 200);
      if (/remote:\\s*true/.test(win)) bad.push(f);"""
assert A2 in s, 'A2 找不到'
B2 = """      const win = src.slice(m.index, m.index + 200);
      if (/remote:\\s*true/.test(win)) {
        const prA = src.indexOf('async function purgeRemote');
        const prB = prA >= 0 ? src.indexOf('\\n}', prA) : -1;
        // 只有「清完自己造的残留之后，顺手把线上的测试流水也清掉」这一处允许 remote
        if (!(prA >= 0 && m.index > prA && m.index < prB)) bad.push(f);
      }"""
s = s.replace(A2, B2, 1)

# ── 3 PRE 快照与收尾断言：改成 Map + 只核无标记的 ──────────────────────────
A3 = "  ok('⛔ 收尾删除前先快照开跑前已有的持仓', /const PRE = new Set\\(/.test(s));"
assert A3 in s, 'A3 找不到'
s = s.replace(A3,
    "  // ⛔ dg 轮升级：PRE 从 Set 改成 Map（要按 note 区分「上一轮残留」与「用户真实持仓」）——\n"
    "  //    用 Set 时残留会被算进「开跑前就有的」而永久跳过，正是 db 轮事故越积越多的根因。\n"
    "  ok('⛔ 收尾删除前先快照开跑前已有的持仓（要带 note，不能只记代码）', /const PRE = new Map\\(/.test(s));", 1)

A4 = """  ok('⛔ 收尾断言改成「自己造的没了 + 原有的原样保留」，不再断言归零',
    /preKept\\.length === PRE\\.size/.test(s) && !/\\(fin\\.items \\|\\| \\[\\]\\)\\.length === 0/.test(s));"""
assert A4 in s, 'A4 找不到'
s = s.replace(A4,
    "  // ⛔ dg 轮升级：「原有的原样保留」只核【无标记】的那部分 ——\n"
    "  //    带标记的残留本来就该被清掉，算进「开跑前就有的」会让这条断言永远红。\n"
    "  ok('⛔ 收尾断言改成「自己造的没了 + 无标记的原样保留」，不再断言归零',\n"
    "    /preRealKept\\.length === PRE_REAL\\.length/.test(s) && !/\\(fin\\.items \\|\\| \\[\\]\\)\\.length === 0/.test(s));", 1)

# ── 4 新增：远程清理的边界必须钉死 ─────────────────────────────────────────
A5 = "  ok('反证：带 remote:true 的旧写法应当判不合格', /remote:\\s*true/.test(\"{ action: 'purgeOps', remote: true }\"));"
assert A5 in s, 'A5 找不到'
B5 = A5 + """

  // ── dg 轮新增：既然开了「连线上清残留」这个口子，边界就得钉死 ──────────────
  //    否则「清残留」随时会变成「删用户持仓」的合法通道（比不开这个口子更危险）。
  const h2 = srcOf['_test_hold2.js'] || '';
  const pA = h2.indexOf('async function purgeRemote');
  const prSrc = pA >= 0 ? h2.slice(pA, h2.indexOf('\\n}', pA)) : '';
  ok('⛔ 远程清理函数存在（不然线上残留永远清不掉）', pA >= 0);
  ok('⛔ 远程清理先拉列表、只保留带 TEST_NOTE 的那部分', /=== TEST_NOTE/.test(prSrc) && /\\.filter\\(/.test(prSrc));
  ok('⛔ 远程清理的 remove 只对 filter 出来的项执行（不许无条件删）',
    /for \\(const it of mine\\)[\\s\\S]{0,160}action: 'remove', code: it\\.code/.test(prSrc));
  ok('⛔ 先删残留再清流水（顺序反了会把用户流水抹掉）',
    prSrc.indexOf("action: 'remove'") > 0 && prSrc.indexOf("action: 'remove'") < prSrc.indexOf("action: 'purgeOps'"));
  ok('⛔ 线上清理只在收尾调用一次', (h2.match(/await purgeRemote\\(/g) || []).length === 1);
  ok('⛔ 远程清理前先确认 syncUpstream 已配置（没配就不打网络）',
    /if \\(!su\\.enabled \\|\\| !su\\.url \\|\\| !su\\.token\\) return/.test(prSrc));"""
s = s.replace(A5, B5, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('✓ _test_test_isolation.js 判据已升级')
