# -*- coding: utf-8 -*-
"""dg 轮：收口 _govCfg / CFG_RANGE 之后，六个守门测试钉着旧字面量假红 —— 改判据不改实现"""
import io

D = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\\"


def patch(fn, pairs):
    p = D + fn
    s = io.open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, '%s 找不到：%s' % (fn, a[:70])
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('✓ ' + fn)


# ① _test_cfgset.js：截取窗口从「CFG_RANGE → CFG_SET 注释」缩成「CFG_RANGE → cfgRangeErrors 注释」
patch('_test_cfgset.js', [
    ("const RANGE_SRC = slice('const CFG_RANGE = {', '// ── 可由面板修改的开关');",
     "// ⛔ dg 轮：CFG_RANGE 已前移到回滚段之前（修 TDZ），再用「CFG_RANGE → CFG_SET」当窗口\n"
     "//    会把中间两千多行顶层代码一起切进来（含回滚段）→ 沙箱里 S 未定义，整个套件崩掉。\n"
     "const RANGE_SRC = slice('const CFG_RANGE = {', '// 返回人类可读的错误列表');"),
])

# ② _test_gov.js：_govCfg 不再落在 govSrc 里，沙箱要补注入它与 CFG_RANGE
patch('_test_gov.js', [
    ("const govSrc = cut('const PUSH_GOV = { day:', '// ---------------- 推送流水');",
     "const govSrc = cut('const PUSH_GOV = { day:', '// ---------------- 推送流水');\n"
     "// ⛔ dg 轮补注入：_govCfg 与它的默认值表 CFG_RANGE 已前移到回滚段之前（修 TDZ），\n"
     "//    不再落在 govSrc 这段里 —— 沙箱少注入就会 ReferenceError 打崩整个套件（第 15 次同类坑）。\n"
     "const cfgRangeSrc = cut('const CFG_RANGE = {', '// 返回人类可读的错误列表');\n"
     "const govCfgSrc = cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');"),
    ("`${todayStrSrc}\\n${govSrc}\\nreturn { govTake, govFilter, govFoot, pushQuota, PUSH_GOV };`",
     "`${todayStrSrc}\\n${cfgRangeSrc}\\n${govCfgSrc}\\n${govSrc}\\nreturn { govTake, govFilter, govFoot, pushQuota, PUSH_GOV };`"),
])

# ③ _test_learn_wire.js：默认值不再写在调用点第二参数，改钉 CFG_RANGE.def
patch('_test_learn_wire.js', [
    ("ok('pushMinProbPre 默认 45', /pushMinProbPre', 45/.test(src));",
     "// ⛔ dg 轮改判据：默认值已从调用点第二参数收进 CFG_RANGE.def，钉写法会假红（第五次同类坑）\n"
     "  ok('pushMinProbPre 默认 45', /pushMinProbPre:\\s*\\{\\s*def:\\s*45/.test(src));"),
])

# ④ _test_logic_audit.js：钉语义（0 能过 + 默认值来自表），不钉旧写法
patch('_test_logic_audit.js', [
    ("ok('_govCfg 用 >=0 判定（0 能通过，不是真值判定）',\n"
     "  /const _govCfg = \\(k, def\\) => \\{[\\s\\S]{0,200}?Number\\.isFinite\\(n\\) && n >= 0 \\? n : def/.test(SRC));",
     "// ⛔ dg 轮改判据：实现从 `(k, def)` 收成 `(k)`（默认值进 CFG_RANGE.def），\n"
     "//    这里钉的是**语义**（0 能通过 / 默认值来自表 / 越界兜住），不是某一种写法。\n"
     "ok('_govCfg 的默认值来自 CFG_RANGE.def（不再由调用点传）',\n"
     "  /const _govCfg = k => \\{/.test(SRC) && !/const _govCfg = \\(k, def\\)/.test(SRC) && /d\\.def/.test(SRC));"),
    ("  const m = SRC.match(/const _govCfg = \\(k, def\\) => \\{([\\s\\S]*?)\\};/);\n"
     "  let g = null;\n"
     "  if (m) {\n"
     "    const S = { config: { A: 0, B: 30, N: -5, X: 'abc' } };\n"
     "    g = eval('(function(S){ const _govCfg = (k, def) => {' + m[1] + '}; return _govCfg; })')(S);\n"
     "  }\n"
     "  ok('_govCfg 能抠出来跑', !!g);\n"
     "  if (g) {\n"
     "    ok('_govCfg(设成 0) 返回 0 而不是默认值', g('A', 55) === 0, '实际 ' + g('A', 55));\n"
     "    ok('_govCfg(设成 30) 返回 30', g('B', 55) === 30);\n"
     "    ok('_govCfg(负数) 回退默认值', g('N', 55) === 55);\n"
     "    ok('_govCfg(非数字) 回退默认值', g('X', 55) === 55);\n"
     "    ok('_govCfg(没配过) 回退默认值', g('ZZZ', 55) === 55);\n"
     "  }",
     "  const m = SRC.match(/const _govCfg = k => \\{([\\s\\S]*?)\\};/);\n"
     "  const rs = SRC.match(/const CFG_RANGE = \\{([\\s\\S]*?)\\};/);\n"
     "  let g = null;\n"
     "  if (m && rs) {\n"
     "    const S = { config: { A: 0, B: 30, N: -5, X: 'abc' } };\n"
     "    g = eval('(function(S){ const CFG_RANGE = {' + rs[1] + '}; const _govCfg = k => {' + m[1] + '}; return _govCfg; })')(S);\n"
     "  }\n"
     "  ok('_govCfg 能抠出来跑', !!g);\n"
     "  if (g) {\n"
     "    // A/B/N/X 都不在 CFG_RANGE 里，走的是「未登记的键：沿用旧行为」那一支\n"
     "    ok('_govCfg(设成 0) 返回 0 而不是默认值', g('A') === 0, '实际 ' + g('A'));\n"
     "    ok('_govCfg(设成 30) 返回 30', g('B') === 30);\n"
     "    ok('_govCfg(负数) 回退默认值', g('N') === 0);\n"
     "    ok('_govCfg(非数字) 回退默认值', g('X') === 0);\n"
     "    ok('_govCfg(没配过) 回退默认值', g('ZZZ') === 0);\n"
     "    // 登记在表里的键：默认值必须来自 CFG_RANGE.def，且越界要兜住（dg 轮新加的一半）\n"
     "    ok('登记键没配过 → 返回表里的 55', g('pushMinProb') === 55, '实际 ' + g('pushMinProb'));\n"
     "    const g2 = eval('(function(S){ const CFG_RANGE = {' + rs[1] + '}; const _govCfg = k => {' + m[1] + '}; return _govCfg; })')({ config: { pushMinProb: 200 } });\n"
     "    ok('登记键越界（200）→ 兜回表里的 55 而不是原样放行', g2('pushMinProb') === 55, '实际 ' + g2('pushMinProb'));\n"
     "  }"),
])

# ⑤ _test_msg_gate.js：沙箱补 CFG_RANGE，marker 改成新签名
patch('_test_msg_gate.js', [
    ("  grab('const _govCfg = (k, def) => {', '};'),",
     "  // ⛔ dg 轮：_govCfg 的默认值现在从 CFG_RANGE.def 取，沙箱必须把它一起注入\n"
     "  grab('const CFG_RANGE = {', '};'),\n"
     "  grab('const _govCfg = k => {', '};'),"),
])

# ⑥ _test_write_validate.js：调用点不再带第二参数
patch('_test_write_validate.js', [
    ("/maxPerCode: _govCfg\\('pushMaxPerCode', 2\\)/.test(SV) && /cap: _govCfg\\('pushDailyMsgs', 8\\)/.test(SV));",
     "// ⛔ dg 轮改判据：调用点已不带第二个默认值参数（默认值只在 CFG_RANGE.def 里有一份）\n"
     "    /maxPerCode: _govCfg\\('pushMaxPerCode'\\)/.test(SV) && /cap: _govCfg\\('pushDailyMsgs'\\)/.test(SV));"),
])
print('全部改完')
