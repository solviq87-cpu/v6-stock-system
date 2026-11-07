# dj 轮：前端 —— 「90日涨停」改说实际窗口 + 读 s.winRule（后端下发没人用 = 白算）
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def rep(s, old, new, cnt=1, tag=''):
    if s.count(old) != cnt:
        print('  !! %s 锚点命中 %d 次（应 %d）: %r' % (tag, s.count(old), cnt, old[:70])); sys.exit(1)
    return s.replace(old, new, cnt)

# ── server.js：池内项带 zt90Txt（前端一行放不下长尾巴，由服务端拼好）──
def fs(s):
    return rep(s, u"      basis: _scoreBasis, scoreNote: scoreNoteOf(score, _scoreBasis)\n    });",
                   u"      basis: _scoreBasis, scoreNote: scoreNoteOf(score, _scoreBasis),\n"
                   u"      zt90Txt: winLabel('zt90', k.rows.length) + winShort('zt90', k.rows.length)\n    });", 1, 'zt90Txt')

rw('server.js', fs)

# ── index.html ──
def fh(s):
    s = rep(s, u"<span>90日涨停 ${x.zt90}次</span>",
               u"<span>${x.zt90Txt || '90日'}涨停 ${x.zt90}次</span>", 1, 'zt90show')
    s = rep(s, u"    const nr = s.needRule || {};",
               u"    const nr = s.needRule || {};\n"
               u"    const wr = s.winRule || {};\n"
               u"    // 「最近 N 日」的窗口：名义 N 日，实际按手里有几根 K 线算（dj 轮）——\n"
               u"    //    数据不足时窗口会短，每只票上都已标注实际窗口，这一行说明口径。\n"
               u"    const winTxt = wr.zt90 ? ` · 涨停窗口按实际K线（名义${wr.zt90.n}日）` : '';", 1, 'wr')
    s = rep(s, u"%` + basisTxt(s.poolBasis) + needTxt;",
               u"%` + basisTxt(s.poolBasis) + needTxt + winTxt;", 1, 'poolinfo')
    return s

rw('public/index.html', fh)
print('完成')
