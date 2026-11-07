# -*- coding: utf-8 -*-
"""dh 轮：收口中性值 + 闸门语义之后，四个守门测试的假红 —— 两处补沙箱注入，两处改判据"""
import io

D = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\\"


def patch(fn, pairs):
    p = D + fn
    s = io.open(p, encoding='utf-8').read()
    done = 0
    for a, b in pairs:
        if b in s:      # 幂等：已改过就跳过
            done += 1
            continue
        if a not in s:
            print('  ⚠ %s 找不到：%s' % (fn, a[:70]))
            continue
        s = s.replace(a, b, 1)
        done += 1
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('✓ %s（%d/%d）' % (fn, done, len(pairs)))


MISS_HELPER = """
// ⛔ dh 轮补注入（第 16 次同类坑）：中性值已收进 MISS_RULE 表、读取走 missingOf，
//    沙箱少了这一段就是 ReferenceError —— 不是变红，是整个套件崩掉。
const MISS_SRC = (() => {
  const i = SV.indexOf('const MISS_RULE = {');
  return SV.slice(i, SV.indexOf('let _rollbackMsg = null;', i));
})();
"""

# ① _test_gov.js：补 MISS_SRC 注入
patch('_test_gov.js', [
    ("const govCfgSrc = cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');",
     "const govCfgSrc = cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');" + MISS_HELPER),
    ("`${todayStrSrc}\\n${cfgRangeSrc}\\n${govCfgSrc}\\n${govSrc}\\nreturn { govTake, govFilter, govFoot, pushQuota, PUSH_GOV };`",
     "`${todayStrSrc}\\n${cfgRangeSrc}\\n${govCfgSrc}\\n${MISS_SRC}\\n${govSrc}\\nreturn { govTake, govFilter, govFoot, pushQuota, PUSH_GOV };`"),
])

# ② _test_bigmoney_ctx.js：补 MISS_SRC 注入（它有多处 new Function，注入到排名那段）
s = io.open(D + '_test_bigmoney_ctx.js', encoding='utf-8').read()
if 'const MISS_SRC' not in s:
    anchor = "const rank = new Function('list', `${SRC_RANK}\\n return list;`);"
    assert anchor in s, 'bigmoney_ctx 找不到 rank 锚点'
    s = s.replace(anchor, MISS_HELPER + "\nconst rank = new Function('list', `${MISS_SRC}\\n${SRC_RANK}\\n return list;`);", 1)
    io.open(D + '_test_bigmoney_ctx.js', 'w', encoding='utf-8', newline='\n').write(s)
    print('✓ _test_bigmoney_ctx.js')
else:
    print('· _test_bigmoney_ctx.js 已有注入')

# ③ _test_fallback_exercised.js：钉语义不钉字面量
patch('_test_fallback_exercised.js', [
    ("  const m = /const w = \\(x\\.ctx && x\\.ctx\\.weight != null\\) \\? x\\.ctx\\.weight : 0\\.7;/.test(SV);\n  ok('大单排序：缺 K 线按中性 0.7', m);",
     "  // ⛔ dh 轮改判据：中性值已收进 MISS_RULE 表，钉字面量会假红（第六次同类坑）；\n"
     "  //    这里要钉的是**语义** —— 缺 K 线时给的是登记过的中性权重，且这个权重是 0.7（不是 0、不是判死）。\n"
     "  const m = /const w = \\(x\\.ctx && x\\.ctx\\.weight != null\\) \\? x\\.ctx\\.weight : missingOf\\('bmCtxWeight'\\);/.test(SV);\n"
     "  ok('大单排序：缺 K 线按中性权重（走 MISS_RULE.bmCtxWeight）', m);\n"
     "  ok('  且这个中性权重登记为 0.7（不是 0，也不是判死）',\n"
     "    /bmCtxWeight:\\s*\\{\\s*kind:\\s*'weight',\\s*value:\\s*0\\.7/.test(SV));"),
])

# ④ _test_quantifier.js：被拦的数从三类变四类
patch('_test_quantifier.js', [
    ("ok('pushGovBlocked 是唯一出口且三者互不重叠（throttled = dropped − lowProb）',\n"
     "  /function pushGovBlocked\\(\\)/.test(SV) && /throttled: Math\\.max\\(0, dropped - lowProb\\)/.test(SV));",
     "// ⛔ dh 轮改判据：多了一类 noScore（取不到质量分被拦），现在是**四类互不包含**；\n"
     "  //    noScore 不许被算进 throttled 里冒充「重复/冷却」（那正是 dc 轮钉过的数量词套娃）。\n"
     "  ok('pushGovBlocked 是唯一出口且四者互不重叠（throttled = dropped − lowProb − noScore）',\n"
     "    /function pushGovBlocked\\(\\)/.test(SV) && /throttled: Math\\.max\\(0, dropped - lowProb - noScore\\)/.test(SV));\n"
     "  ok('noScore 也被钳在剩余额度内',\n"
     "    /noScore = Math\\.min\\(Math\\.max\\(0, \\+PUSH_GOV\\.noScore \\|\\| 0\\), Math\\.max\\(0, dropped - lowProb\\)\\)/.test(SV));"),
])
print('全部改完')
