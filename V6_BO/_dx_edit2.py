# -*- coding: utf-8 -*-
# dx 轮 · 补丁2：paperBackfillTrades 自愈「side 编码损坏的重复流水」
# 历史数据里有一条 002900 买入被记了两次：一次 side="买入"（干净）、一次 side="买\ufffd\ufffd\ufffd"
# （"入" 编码损坏成 3 个 U+FFFD），同一 t|code|shares|amount。对账重算时多出 4500 股幽灵持仓 → dPos=1。
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    n = s.count(old)
    if n != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % n)
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % n)
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

rep('server.js',
    u"""function paperBackfillTrades(key) {
  const acc = PAPER[key];
  if (!acc || !Array.isArray(acc.trades)) return 0;
  let n = 0;
  for (const t of acc.trades) {""",
    u"""function paperBackfillTrades(key) {
  const acc = PAPER[key];
  if (!acc || !Array.isArray(acc.trades)) return 0;
  let n = 0;
  // ⛔ dx 轮：先修「side 编码损坏」并去重。历史数据里出现过一条 002900 买入被记了两次：
  //    一次 side="买入"、一次 side="买\\ufffd\\ufffd\\ufffd"（"入" 的 UTF-8 字节损坏，解码成 U+FFFD），
  //    同一 t|code|shares|amount —— 对账重算时多出 4500 股幽灵持仓 → dPos=1，且这条损坏流水
  //    藏在线上 paper.json 全量里（/api/paper 只回最近 30 条，看不到它），会随同步反复回到本地。
  //    U+FFFD 是无效 UTF-8 的解码产物，不会出现在正常写入的 side（只有「买入/卖出」）里，
  //    所以按「买→买入 / 卖→卖出」还原是安全的；还原后两条撞上同一去重键，只保留一条。
  for (const t of acc.trades) {
    if (t && typeof t.side === 'string' && t.side.indexOf('\\uFFFD') >= 0) {
      t.side = t.side.indexOf('买') >= 0 ? '买入' : (t.side.indexOf('卖') >= 0 ? '卖出' : t.side);
      n++;
    }
  }
  {
    const seen = new Set();
    const keep = [];
    let dup = 0;
    for (const t of acc.trades) {
      const k = paperTradeKey(t);
      if (seen.has(k)) { dup++; continue; }
      seen.add(k); keep.push(t);
    }
    if (dup) { acc.trades = keep; acc.tradesDropped = (Number(acc.tradesDropped) || 0) + dup; n += dup; }
  }
  for (const t of acc.trades) {""",
    'paperBackfillTrades 自愈 side 损坏 + 去重')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
