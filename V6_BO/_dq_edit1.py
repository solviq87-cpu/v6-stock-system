# -*- coding: utf-8 -*-
# dq 轮改码 第 1 步：给「上一次快照」建时点口径登记表 + 唯一出口
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

ANCHOR = 'function stateCut() {'

BLOCK = '''// ─── 「上一次快照」的时点口径登记表（2026-10-07 dq 轮）──────────────────
// ⛔ 把某个量存起来、下一轮拿它来做差，就必须回答：**那份快照是「什么时候」的**。
//    `mainInflow` 这类字段是**当日累计**（FLOW_WIN='当日累计'），跨天归零 ——
//    昨天收盘存下的是昨天的累计数，今天开盘拿今天的累计数去减它，减出来的
//    「增量」横跨两个不同的累计周期，毫无意义。实证：某板块昨天净流出 -2 亿、
//    今天开盘才流入 1000 万，做差得 d = 2.1 亿，直接越过 3000 万的突增门槛
//    → 开盘就误报「资金突增 2.1 亿」，而当天真实流入只有 1000 万。
//    更麻烦的是这类缓存全是**内存 Map**（本轮扫出 11 个，无一落盘），
//    所以「上一次」既可能是上一 tick，也可能是昨天收盘那一 tick ——
//    光判 `prev != null` 分不出这两种情况（它只挡住了「首次运行」，挡不住「跨天」）。
//    现在每份快照都记下它属于哪一天（YYYYMMDD），做差前先验是不是同一个累计周期。
const PREV_SNAP = {
  sectorFlow: { label: '板块主力净流入', kind: 'dayCum', why: 'mainInflow 是当日累计，跨天归零' }
};
const _prevSnapDay = {};        // pool -> 那份快照属于哪一天
const _prevSnapTs = {};         // pool -> 那份快照的墙上时间（面板可观测用）
// 能不能拿「上一次」来做差：true = 与本轮同属一个累计周期
function prevSnapUsable(pool, day) {
  if (!PREV_SNAP[pool]) { console.error('[prevSnapUsable] 未登记的快照池: ' + pool); return false; }
  return _prevSnapDay[pool] === day;
}
// 建档：本轮快照存进去了，把它的时点一起记下
function prevSnapMark(pool, day) {
  if (!PREV_SNAP[pool]) { console.error('[prevSnapMark] 未登记的快照池: ' + pool); return; }
  _prevSnapDay[pool] = day;
  _prevSnapTs[pool] = Date.now();
}
// 面板可观测：让「突增监控的基线是哪天建的」看得见，而不是只在日志里说
function prevSnapState() {
  const o = {};
  for (const k of Object.keys(PREV_SNAP)) {
    o[k] = {
      label: PREV_SNAP[k].label, kind: PREV_SNAP[k].kind,
      day: _prevSnapDay[k] || null, ts: _prevSnapTs[k] || null,
      usable: _prevSnapDay[k] === todayStr()
    };
  }
  return o;
}
'''

n = s.count(ANCHOR)
if n != 1:
    print('FAIL step1: anchor count = %d' % n); sys.exit(1)
s = s.replace(ANCHOR, BLOCK + ANCHOR, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step1: PREV_SNAP + prevSnapUsable/prevSnapMark/prevSnapState 已写入')
