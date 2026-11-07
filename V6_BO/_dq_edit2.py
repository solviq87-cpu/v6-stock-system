# -*- coding: utf-8 -*-
# dq 轮改码 第 2 步：板块突增做差前先验「基线是不是同一个累计周期」+ /api/state 下发
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

REPS = [
    # ① 板块突增：跨天/首次只建档不做差
    ("""let _prevSectorFlow = new Map();      // 板块名 -> 上一次主力净流入
const _sectorAlertMap = new Map();    // 板块名 -> 上次推送 ts（15分钟去重）
async function sectorSurgeScan() {
  if (!isTradingTime() || !S.sectors.length) { return; }
  const cur = new Map(S.sectors.map(s => [s.name, s.mainInflow || 0]));
  const surges = [];
  for (const s of S.sectors) {
    const prev = _prevSectorFlow.get(s.name);
    if (prev != null) {
      const d = (s.mainInflow || 0) - prev;
      if (d >= 3e7 && (s.mainInflow || 0) > 0) surges.push({ name: s.name, delta: d, pct: s.pct || 0 });
    }
  }
  _prevSectorFlow = new Map(cur);
  if (!surges.length) return;""",
     """let _prevSectorFlow = new Map();      // 板块名 -> 上一次主力净流入（⛔ 是「当日累计」，见 PREV_SNAP）
const _sectorAlertMap = new Map();    // 板块名 -> 上次推送 ts（15分钟去重）
async function sectorSurgeScan() {
  if (!isTradingTime() || !S.sectors.length) { return; }
  const cur = new Map(S.sectors.map(s => [s.name, s.mainInflow || 0]));
  // ⛔ 基线必须和本轮同属一个累计周期。mainInflow 是**当日累计**，跨天归零；
  //    昨天收盘存下的是昨天的累计数，今天开盘拿今天的累计去减它，减出来的「增量」
  //    横跨两个周期 —— 实证：昨天净流出 -2 亿、今天才流入 1000 万，d = 2.1 亿 ≥ 3000 万门槛
  //    → 开盘就误报「资金突增 2.1 亿」，而当天真实流入只有 1000 万。
  //    ⛔ 光判 `prev != null` 只挡得住「首次运行」，挡不住「跨天」—— 两种情况的 prev 都存在。
  const _day = todayStr();
  const canDiff = prevSnapUsable('sectorFlow', _day);
  const surges = [];
  if (canDiff) {
    for (const s of S.sectors) {
      const prev = _prevSectorFlow.get(s.name);
      if (prev != null) {
        const d = (s.mainInflow || 0) - prev;
        if (d >= 3e7 && (s.mainInflow || 0) > 0) surges.push({ name: s.name, delta: d, pct: s.pct || 0 });
      }
    }
  }
  _prevSectorFlow = new Map(cur);
  prevSnapMark('sectorFlow', _day);
  if (!surges.length) return;""", 1),

    # ② /api/state 下发，让「突增基线是哪天建的」看得见
    ("""    outN: outNState(),""",
     """    outN: outNState(),
    prevSnap: prevSnapState(),""", 1),
]

for i, (o, nw, want) in enumerate(REPS):
    c = s.count(o)
    if c != want:
        print('FAIL step2 #%d: count=%d want=%d' % (i + 1, c, want)); sys.exit(1)
    s = s.replace(o, nw, 1)
    print('  repl #%d ok' % (i + 1))

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step2: 板块突增时点口径 + /api/state 下发')
