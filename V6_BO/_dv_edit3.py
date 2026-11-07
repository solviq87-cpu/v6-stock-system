# -*- coding: utf-8 -*-
# dv 轮改码③：前端把「命中率的分母是谁」与「静默跳过台账」显示出来
import io

P = "public/index.html"
src = io.open(P, "r", encoding="utf-8").read()
steps = []

def rep(old, new, want=1):
    global src
    n = src.count(old)
    if n != want:
        steps.append("FAIL(%d!=%d) %s" % (n, want, old[:70].replace("\n", "\\n")))
        return False
    src = src.replace(old, new, want)
    steps.append("OK  %s" % (old[:70].replace("\n", "\\n")))
    return True

rep(u"""          return `<tr><td colspan="6" class="muted" style="white-space:normal" title="${(_pkd.kinds||[]).map(k=>k.why).join(' ')}">分档口径：${_pkd.note}。当前样本 概率 ${_n.prob||0} 条 / 评分 ${_n.score||0} 条${_ks ? '（' + _ks + '）' : ''}</td></tr>`;
        })();""",
u"""          return `<tr><td colspan="6" class="muted" style="white-space:normal" title="${(_pkd.kinds||[]).map(k=>k.why).join(' ')}">分档口径：${_pkd.note}。当前样本 概率 ${_n.prob||0} 条 / 评分 ${_n.score||0} 条${_ks ? '（' + _ks + '）' : ''}</td></tr>`;
        })() +
        // ⛔ dv 轮：命中率的分母必须看得见 —— 实测样本库 1959 条只有 368 条进得了档，
        //    另外 1591 条（回测 600／缺次日口径 737／缺概率 242…）被静默跳过。
        //    不说出来，用户会把「证据不足」误读成「样本还没积累够」，从而干等。
        (function(){
          const _es = s.empSkip || {};
          if (!_es.scanned) return '';
          const _top = (_es.by || []).slice(0, 4).map(x => `${x.label} ${x.n}`).join('、');
          return `<tr><td colspan="6" class="muted" style="white-space:normal">样本存活：${_es.note || ''}${_top ? '　排除：' + _top : ''}（排除项按设计不参与实测标定，不是数据丢失）</td></tr>`;
        })() +
        (function(){
          const _sk = s.skipStat || {};
          if (!_sk.total) return '';
          const _top = (_sk.top || []).slice(0, 5).map(x => `${x.label} ${x.n}`).join('、');
          return `<tr><td colspan="6" class="muted" style="white-space:normal">跳过台账：累计 ${_sk.total} 次${_top ? '　' + _top : ''}（被判据正常排除的计数，非报错）</td></tr>`;
        })();""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
