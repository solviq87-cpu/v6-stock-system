# -*- coding: utf-8 -*-
# du 轮改码③：前端 —— 证据不全单独成徽标；流水列表说清"共几笔/显示几笔"
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
      // ⛔ 已定位的老口径遗留不该显示成红色告警（dt 轮）：红字配一句「可用重置清空重来」
      //    会把人推向清空全部流水的不可逆动作；而真相是历史成本基准少记了买入费，
      //    现金与持仓都没错。这里换成中性提示，并把「不必改动」写进徽标。
      ? (p.audit.explained""",
u"""    // ⛔ du 轮：流水被容量上限裁过 → 这是「证据不全」，不是「账记错了」。
    //    红色「账目对不上」会把人引向重置（把剩下的几百笔也删掉，不可逆）。
    //    实测：pre 账户丢掉最老 20 笔后报「差 37.5 万」，真相只是历史流水没了。
    ((p.audit && p.audit.incomplete)
      ? `<span class="tag" style="background:#fffbe6;color:#8a6d00" title="${(p.audit.why || '').replace(/"/g, '&quot;')}">⚠️ 证据不全：流水已达上限 ${p.audit.cap} 笔，无法判定（勿重置）</span>`
      : (p.audit && p.audit.ok === false)
      // ⛔ 已定位的老口径遗留不该显示成红色告警（dt 轮）：红字配一句「可用重置清空重来」
      //    会把人推向清空全部流水的不可逆动作；而真相是历史成本基准少记了买入费，
      //    现金与持仓都没错。这里换成中性提示，并把「不必改动」写进徽标。
      ? (p.audit.explained""")

rep(u"""  const tr = (p.trades || []).slice(0, 12);
  document.getElementById('pp' + suf + 'Trades').innerHTML = tr.length ? tr.map(x =>
    `<div class="sig ${x.side === '卖出' && x.pnl < 0 ? 'zt' : ''}" style="font-size:12px">${new Date(x.t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} <b>${x.side}</b> ${x.name}(${x.code}) ${x.shares}股 @${x.price}${x.side === '卖出' ? ' 盈亏' + (x.pnl > 0 ? '+' : '') + x.pnl : ''} <span class="muted">${x.reason || ''}</span></div>`).join('') : '<div class="muted" style="font-size:12px">暂无交易记录</div>';""",
u"""  const tr = (p.trades || []).slice(0, 12);
  // ⛔ du 轮：同一份流水在系统里其实是三个数 —— 这里只画 12 笔、接口只给 30 笔、
  //    而对账按全量算。不把真实总数标出来，用户会以为看到的就是全部。
  const trTotal = Number(p.tradesTotal) || tr.length;
  document.getElementById('pp' + suf + 'Trades').innerHTML = tr.length ? tr.map(x =>
    `<div class="sig ${x.side === '卖出' && x.pnl < 0 ? 'zt' : ''}" style="font-size:12px">${new Date(x.t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} <b>${x.side}</b> ${x.name}(${x.code}) ${x.shares}股 @${x.price}${x.side === '卖出' ? ' 盈亏' + (x.pnl > 0 ? '+' : '') + x.pnl : ''} <span class="muted">${x.reason || ''}</span></div>`).join('')
    + (trTotal > tr.length ? `<div class="muted" style="font-size:11px;padding-top:4px">共 ${trTotal} 笔，此处显示最近 ${tr.length} 笔</div>` : '')
    : '<div class="muted" style="font-size:12px">暂无交易记录</div>';""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
