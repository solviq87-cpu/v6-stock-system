# di 轮：前端精选池 —— 评分「数据不足」必须看得见（与八字 baziMiss 同一条原则）
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败'); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def rep(s, old, new, cnt=1):
    if s.count(old) != cnt:
        print('  !! 锚点命中 %d 次（应 %d）: %r' % (s.count(old), cnt, old[:80])); sys.exit(1)
    return s.replace(old, new, cnt)

def f(s):
    # ① 在 pTag 之后定义 scoreNote 标记
    s = rep(s, u"      const pTag = x.focused ? '<span class=\"tag\" style=\"background:#d3f9d8;color:#2b8a3e\">聚焦</span>' : '';",
               u"      const pTag = x.focused ? '<span class=\"tag\" style=\"background:#d3f9d8;color:#2b8a3e\">聚焦</span>' : '';\n"
               u"      // ⛔ 评分「数据不足」必须看得见（di 轮）：同一个 62 分，可能是全项算过的 62，\n"
               u"      //    也可能只算过 4 个分项 —— 后者会被同一条评分线判死，面板上却看不出原因。\n"
               u"      const snTag = x.scoreNote ? `<span class=\"tag\" style=\"background:#fff4e6;color:#a15c00;cursor:help\" title=\"${String(x.scoreNote).replace(/\"/g, '&quot;')}\">⚠评分未满项</span>` : '';")
    # ② 分数本身：null 显示 '-'，并挂 title
    s = rep(s, u"<span class=\"score ${c}\">${x.score}</span>",
               u"<span class=\"score ${c}\"${x.scoreNote ? ` title=\"${String(x.scoreNote).replace(/\"/g, '&quot;')}\"` : ''}>${x.score == null ? '-' : x.score}</span>${snTag}")
    return s

rw('public/index.html', f)
print('完成')
