# -*- coding: utf-8 -*-
import io, sys

P = 'server.js'
src = io.open(P, encoding='utf-8', newline='').read()
orig = src
def rep(old, new, tag, n=1):
    global src
    c = src.count(old)
    if c != n:
        print('FAIL[%s] count=%d want=%d' % (tag, c, n)); sys.exit(1)
    src = src.replace(old, new, n)
    print('OK  ' + tag)

# ── 0) 插入 STALE 登记表（放在 dk 轮 FAIL_RULE 之前 → 不影响已有守门的沙箱切块）──
ANCHOR = u"// ─── 「失败」的说法登记表（2026-10-07 dk 轮）────────────────────────────"
BLK = u'''// ─── 「这份数据新鲜吗」的说法登记表（2026-10-07 dm 轮）────────────────────
// 上一轮（dl）收的是「成功有几种说法」；这一轮往外一层：**同一个结论在四个出口说不说同一句话**。
// 实测最刺眼的一处 —— 数据源没回来时，后端 `if (marketReady())` 决定**保留上一次的结果**
//   （12 处判据、日志里 14 处「行情源」+ 9 处「未就绪」+ 4 处「保留上一次」），
//   而**面板侧 0 处提及**：界面照旧显示「更新于 10:23:11」，那个时间是**上一次**的，
//   用户看到的就是"刚刚更新过"。这正是本轮要治的错位 —— **面板说没事、日志在报警**。
// 同一个「陈旧」在系统里还写过五遍（kStale / pxStale / reviewStale / stale / staleBoard），
//   其中 kStale 与 staleBoard 面板同样 0 处可见 —— 同一个结论五种写法、两种压根没人看。
// ⛔ 只在日志里说 = 用户永远看不到。现在登记 STALE_KIND 四种新鲜度 + STALE_RULE 各池，
//   唯一写入 staleMark（顺带打同一句日志）、唯一读取 staleLine / staleState（面板同一句话）。
const STALE_KIND = {
  fresh: { mark: '',   word: '更新于',   note: '本轮真算出来的 \\u2192 面板写「更新于 HH:MM:SS」' },
  held:  { mark: '\\u26a0\\ufe0f', word: '沿用上次', note: '行情源没回来 \\u2192 沿用上一次结果；\\u26a0 面板必须写「\\u26a0\\ufe0f 行情源未就绪 \\u00b7 沿用上次 HH:MM:SS」，不许写「更新于」' },
  empty: { mark: '\\u26aa', word: '本轮无',   note: '行情源就绪但本轮确实 0 条（dl 轮的 empty），不是故障' },
  none:  { mark: '\\u2014',  word: '未产出',   note: '本轮还没算过，也没有「上一次」可沿用' }
};
const STALE_RULE = {
  bigMoney: '大单流入', pre: '启动前埋伏', buzhang: '补涨龙', myrules: '自定义规则',
  nextplan: '次日计划', review: '收盘复盘', sectors: '板块', breadth: '市场宽度',
  steadyUp: '连续收涨', trendScan: '趋势扫描', ztPool: '涨停池', candidatePool: '精选池'
};
// ⛔ 单独一张状态表，不往 S.xxx 上挂字段：steadyUp / trendScan / ztPool / candidatePool 是**数组**，
//    数组上挂的属性过一遍 JSON 就没了（ci 轮「落盘往返」的老坑），挂了等于没挂。
const _stale = {};
function staleMark(pool, kind) {
  if (!STALE_RULE[pool]) { console.error('[stale] 未登记的池: ' + pool); return; }
  if (!STALE_KIND[kind]) { console.error('[stale] 未登记的新鲜度: ' + kind); return; }
  const prev = _stale[pool];
  _stale[pool] = { kind, t: Date.now() };
  // ⛔ 日志侧与面板侧必须是同一句话：只在日志里说 = 用户永远看不到
  if (kind === 'held' && (!prev || prev.kind !== 'held'))
    console.log(`[stale] ${STALE_RULE[pool]}：行情源未就绪，沿用上一次结果（面板已标注）`);
}
function staleOf(pool) { const v = _stale[pool]; return v ? v.kind : ''; }
function staleWord(pool) { const k = staleOf(pool); return k ? STALE_KIND[k].word : ''; }
// 面板 / 文案的唯一出口：把「更新于 HH:MM:SS」与「⚠️ 行情源未就绪 · 沿用上次 HH:MM:SS」收在一处
function staleLine(pool, time) {
  const k = staleOf(pool), t = time || '-';
  if (k === 'held') return `${STALE_KIND.held.mark} 行情源未就绪 \\u00b7 ${STALE_KIND.held.word} ${t}`;
  if (k === 'fresh') return `更新于 ${t}`;
  if (k === 'empty') return `${STALE_KIND.empty.mark} 本轮无符合条件的结果（${t}）`;
  return '未产出';
}
function staleState() {
  const o = {};
  for (const k of Object.keys(STALE_RULE)) {
    const v = _stale[k] || {}, kind = v.kind || 'none';
    o[k] = { name: STALE_RULE[k], kind, mark: STALE_KIND[kind].mark, word: STALE_KIND[kind].word, t: v.t || 0 };
  }
  return o;
}
function staleRuleState() {
  const o = {};
  for (const k of Object.keys(STALE_KIND)) o[k] = { mark: STALE_KIND[k].mark, word: STALE_KIND[k].word, note: STALE_KIND[k].note };
  return o;
}
'''
rep(ANCHOR, BLK + ANCHOR, 'insert STALE block')

# ── 1) bigMoney ──
rep(u"  if (!base.length) { if (marketReady()) S.bigMoney = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('noCand') }; return []; }",
    u"  if (!base.length) {\n"
    u"    // ⛔ dm 轮：行情源没回来 → 必须明说「沿用上一次」，不能只在日志里说（面板以前 0 处提及）\n"
    u"    if (marketReady()) { S.bigMoney = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('noCand') }; staleMark('bigMoney', 'empty'); }\n"
    u"    else staleMark('bigMoney', 'held');\n"
    u"    return [];\n"
    u"  }", 'bigMoney 空/未就绪')
rep(u"    stat: { down: downN, cold: coldN, heavy: heavyN, total: list.length }\n  };\n  return list;",
    u"    stat: { down: downN, cold: coldN, heavy: heavyN, total: list.length }\n  };\n  staleMark('bigMoney', 'fresh');\n  return list;",
    'bigMoney 成功')

# ── 2) pre ──
rep(u"  if (!cands.length) { if (marketReady()) S.pre = { time, items: [], empty: emptyWhyOf('noCand') }; return []; }",
    u"  if (!cands.length) {\n"
    u"    if (marketReady()) { S.pre = { time, items: [], empty: emptyWhyOf('noCand') }; staleMark('pre', 'empty'); }\n"
    u"    else staleMark('pre', 'held');\n"
    u"    return [];\n"
    u"  }", 'pre 空/未就绪')
rep(u"  S.pre = { time, items: out.slice(0, 12) };",
    u"  S.pre = { time, items: out.slice(0, 12) };\n  staleMark('pre', 'fresh');", 'pre 成功')

# ── 3) buzhang ──
rep(u"  if (!S.ztPool.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('justNone') }; return; }",
    u"  if (!S.ztPool.length) {\n"
    u"    if (marketReady()) { S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('justNone') }; staleMark('buzhang', 'empty'); }\n"
    u"    else staleMark('buzhang', 'held');\n"
    u"    return;\n"
    u"  }", 'buzhang 空池(无涨停)')
rep(u"  if (!cands.length) { if (marketReady()) S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('gate') }; return; }",
    u"  if (!cands.length) {\n"
    u"    if (marketReady()) { S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: [], empty: emptyWhyOf('gate') }; staleMark('buzhang', 'empty'); }\n"
    u"    else staleMark('buzhang', 'held');\n"
    u"    return;\n"
    u"  }", 'buzhang 空池(闸门)')
rep(u"  S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: out.slice(0, 12) };",
    u"  S.buzhang = { time: new Date().toLocaleTimeString('zh-CN'), items: out.slice(0, 12) };\n  staleMark('buzhang', 'fresh');", 'buzhang 成功')

# ── 4) myrules ──
rep(u"    if (marketReady()) S.myrules = { date: NP.localDate(), time: new Date().toLocaleTimeString('zh-CN'), count: 0, scanned: 0, items: [], all: [], empty: emptyWhyOf('noCand') };\n    return S.myrules;",
    u"    if (marketReady()) { S.myrules = { date: NP.localDate(), time: new Date().toLocaleTimeString('zh-CN'), count: 0, scanned: 0, items: [], all: [], empty: emptyWhyOf('noCand') }; staleMark('myrules', 'empty'); }\n"
    u"    else staleMark('myrules', 'held');\n"
    u"    return S.myrules;", 'myrules 空/未就绪')
rep(u"    all: r.all.slice(0, 30),\n  };",
    u"    all: r.all.slice(0, 30),\n  };\n  staleMark('myrules', 'fresh');", 'myrules 成功')

# ── 5) nextplan ──
rep(u"    if (marketReady()) S.nextplan = { date: NP.localDate(), time: new Date().toLocaleTimeString('zh-CN'), plan: null, text: null, cand: 0, universeN: 0, missKline: 0, empty: emptyWhyOf('noCand') };\n    return S.nextplan;",
    u"    if (marketReady()) { S.nextplan = { date: NP.localDate(), time: new Date().toLocaleTimeString('zh-CN'), plan: null, text: null, cand: 0, universeN: 0, missKline: 0, empty: emptyWhyOf('noCand') }; staleMark('nextplan', 'empty'); }\n"
    u"    else staleMark('nextplan', 'held');\n"
    u"    return S.nextplan;", 'nextplan 空/未就绪')
rep(u"    cand: cands.length, universeN: universe.length, missKline: cands.length - universe.length,\n  };",
    u"    cand: cands.length, universeN: universe.length, missKline: cands.length - universe.length,\n  };\n  staleMark('nextplan', 'fresh');", 'nextplan 成功')

# ── 6) review ──
rep(u"  } else if (!S.ztPool.length) {\n    if (marketReady()) S.review = mkReviewShell([]);\n  }",
    u"  } else if (!S.ztPool.length) {\n"
    u"    if (marketReady()) { S.review = mkReviewShell([]); staleMark('review', 'empty'); }\n"
    u"    else staleMark('review', 'held');\n"
    u"  }", 'review 分支1')
rep(u"  if (!S.ztPool.length) { if (marketReady()) S.review = mkReviewShell([]); return; }",
    u"  if (!S.ztPool.length) {\n"
    u"    if (marketReady()) { S.review = mkReviewShell([]); staleMark('review', 'empty'); }\n"
    u"    else staleMark('review', 'held');\n"
    u"    return;\n"
    u"  }", 'review 分支2')
rep(u"  S.review = Object.assign(mkReviewShell(items), { head: items.length ? todayHead() : '' });",
    u"  S.review = Object.assign(mkReviewShell(items), { head: items.length ? todayHead() : '' });\n  staleMark('review', 'fresh');", 'review 成功')

# ── 7) /api/state 下发 ──
rep(u"    doneRule: doneRuleState(),\n    pushLast: pushLast(),",
    u"    doneRule: doneRuleState(),\n    pushLast: pushLast(),\n    staleState: staleState(),\n    staleRule: staleRuleState(),",
    'api/state 下发 stale')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('written, delta=%d chars' % (len(src) - len(orig)))
