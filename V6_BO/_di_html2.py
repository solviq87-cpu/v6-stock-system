# di 轮：前端真的读 needRule（后端算了没人用 = 白算，cg 轮原则）
import io, sys

def rep(s, old, new, cnt=1):
    if s.count(old) != cnt:
        print('  !! 锚点命中 %d 次（应 %d）: %r' % (s.count(old), cnt, old[:80])); sys.exit(1)
    return s.replace(old, new, cnt)

p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()

s = rep(s, u"      return ` · 基准日 ${d}`;\n    };\n",
           u"      return ` · 基准日 ${d}`;\n    };\n"
           u"    // 「够了」的尺子（di 轮）：入池只要 5 根，而完整评分与学习样本要 45 根 ——\n"
           u"    //    同一把「评分线」量的是两把尺子，这一行必须让用户看得见，否则短数据票\n"
           u"    //    分数天然偏低，用户只会以为它「真的差」。\n"
           u"    const nr = s.needRule || {};\n"
           u"    const needTxt = (nr.pool && nr.backtest)\n"
           u"      ? ` · 入池≥${nr.pool}根K线（完整评分/学习样本需≥${nr.backtest}根）` : '';\n")

s = rep(s, u"    document.getElementById('poolInfo').textContent = `池内 ${s.poolSize} 只 · ${_pn.pool} · 概率推送线 ${(s.probThreshold * 100).toFixed(0)}%` + basisTxt(s.poolBasis);",
           u"    document.getElementById('poolInfo').textContent = `池内 ${s.poolSize} 只 · ${_pn.pool} · 概率推送线 ${(s.probThreshold * 100).toFixed(0)}%` + basisTxt(s.poolBasis) + needTxt;")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))
