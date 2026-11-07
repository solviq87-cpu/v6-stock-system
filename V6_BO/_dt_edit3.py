# -*- coding: utf-8 -*-
# dt 轮补修：前端对账徽标区分「真对不上」与「老口径遗留（已定位，无需重置）」
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

rep(u"""    ((p.audit && p.audit.ok === false)
      ? `<span class="tag" style="background:#fff5f5;color:#c92a2a" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">⚠️ 账目对不上：${p.audit.why || '账户与流水不一致'}</span>`
      : (p.audit ? `<span class="tag muted" title="账户余额与逐笔流水已对账一致（${p.audit.trades} 笔）">✓ 账目已对账</span>` : '')) +""",
u"""    ((p.audit && p.audit.ok === false)
      // ⛔ 已定位的老口径遗留不该显示成红色告警（dt 轮）：红字配一句「可用重置清空重来」
      //    会把人推向清空全部流水的不可逆动作；而真相是历史成本基准少记了买入费，
      //    现金与持仓都没错。这里换成中性提示，并把「不必改动」写进徽标。
      ? (p.audit.explained
        ? `<span class="tag" style="background:#fffbe6;color:#8a6d00" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">ℹ️ 老口径遗留：${p.audit.basisGapN} 笔差 ${p.audit.basisGap} 元，无需重置</span>`
        : `<span class="tag" style="background:#fff5f5;color:#c92a2a" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">⚠️ 账目对不上：${p.audit.why || '账户与流水不一致'}</span>`)
      : (p.audit ? `<span class="tag muted" title="账户余额与逐笔流水已对账一致（${p.audit.trades} 笔）">✓ 账目已对账</span>` : '')) +""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
