# -*- coding: utf-8 -*-
# dr 轮：三个守门套件的沙箱注入清单漏了 ppTxt（第 18 次踩这个坑）——
#        我在 empTable / corr / fusedProb 里引入了 ppTxt，它们切的是源码片段，
#        片段里没有 ppTxt 的定义 → ReferenceError 整段崩掉（不是变红）。
import io, sys

PPSRC = """// ⛔ 沙箱补装：dr 轮起 empTable / 相关系数 / fusedProb 的文案要走 ppTxt（百分点单位）。
//    这些套件切的是源码片段，片段里没有它的定义 → 必须一起切进来，否则 ReferenceError 崩整段。
const __ppStart = SRC.indexOf('function ppTxt(v, signed) {');
const PP_TXT = __ppStart >= 0 ? SRC.slice(__ppStart, SRC.indexOf('\\n}\\n', __ppStart) + 3) : '';
"""

EDITS = [
    # ① empcalib：parts 里加一段
    ('_test_empcalib.js',
     "  grab('const isLiveSample =', '\\n'),",
     "  grab('const isLiveSample =', '\\n'),\n"
     "  // ⛔ dr 轮补：empTable 的证据文案走 ppTxt（百分点单位），沙箱缺了它 → ReferenceError 崩整段\n"
     "  grab('function ppTxt(v, signed) {', '\\n}\\n'),"),
    # ② hindsight：mkCorr 的注入形参 + 实参
    ('_test_hindsight.js',
     "  return new Function('buckets', 'dayStats', 'MIN_LEARN_DAYS', 'CORR_REFU_N', 'CORR_REFU_GAP',\n"
     "    'neutralRate', 'EXP', 'GLOBAL', '_cl', 'S', corrSrc + '\\n return S.learn.buckets;'\n"
     "  )(buckets, dayStats, 5, CORR_REFU_N, CORR_REFU_GAP, neutralRate, {}, 0.5, _cl, S)[bucketName];",
     "  // ⛔ dr 轮补：corrSrc 的文案走 ppTxt，沙箱必须装它\n"
     "  const _ppSrc = SRC.slice(SRC.indexOf('function ppTxt(v, signed) {'), SRC.indexOf('\\n}\\n', SRC.indexOf('function ppTxt(v, signed) {')) + 3);\n"
     "  return new Function('buckets', 'dayStats', 'MIN_LEARN_DAYS', 'CORR_REFU_N', 'CORR_REFU_GAP',\n"
     "    'neutralRate', 'EXP', 'GLOBAL', '_cl', 'S', _ppSrc + '\\n' + corrSrc + '\\n return S.learn.buckets;'\n"
     "  )(buckets, dayStats, 5, CORR_REFU_N, CORR_REFU_GAP, neutralRate, {}, 0.5, _cl, S)[bucketName];"),
    # ③ learn_fuse：mk 的沙箱源码里补一段
    ('_test_learn_fuse.js',
     "const mk = (signals, ov) => new Function('S', 'LEARNALL', 'A', 'laDb', 'console', 'ov', `\n"
     "${probSrc}\n${empSrc}",
     "const mk = (signals, ov) => new Function('S', 'LEARNALL', 'A', 'laDb', 'console', 'ov', `\n"
     "${probSrc}\n${empSrc}\n"
     "// ⛔ dr 轮补：fusedProb 的文案走 ppTxt，沙箱必须装它\n"
     "${cut('function ppTxt(v, signed) {', 'function stateCut')}"),
]

for path, old, new in EDITS:
    s = io.open(path, encoding='utf-8').read()
    c = s.count(old)
    if c != 1:
        print('FAIL %s: count=%d' % (path, c)); sys.exit(1)
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched %s' % path)

print('OK: 三个套件已补装 ppTxt')
