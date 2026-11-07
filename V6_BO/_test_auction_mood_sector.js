// id 轮守门：竞价推送 = 市场情绪 × 板块强度 × 题材持久度
//   ① themePersistOf：题材持久度分档（连板票数 + 最高板 + 规模）
//   ② inferZTProb：输出附加 theme/themeStrength/themeScore/persist 字段，且按 marketMood.advice 乘权（情绪联动，不是降门槛）
//   ③ buildAuctionAlertMessage：正文顶部标注市场情绪摘要；同板块去重（最多 2 只）；持久度优先→板块强度优先→prob 排序
// 用法：从 server.js 抠真实函数体用 new Function 真跑（与守门总榜同一手法），不重新实现逻辑。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra !== undefined ? '  → ' + extra : '')); } };

// —— 抠函数体的花括号配平（与 _test_data_cap.js 同款）
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}

console.log('\n=== id 轮：竞价 × 情绪 × 板块 × 持久度 守门 ===\n');

// ---------- ① themePersistOf 分档 ----------
console.log('【① themePersistOf：题材持久度分档】');
{
  const S = { ztPool: [
    { code: 'A1', sector: '新能源', limitUpCount: 2 },
    { code: 'A2', sector: '新能源', limitUpCount: 3 },
    { code: 'A3', sector: '新能源', limitUpCount: 2 },
    { code: 'A4', sector: '新能源', limitUpCount: 4 },
    { code: 'B1', sector: '冷门', limitUpCount: 1 },
    { code: 'C1', sector: '中档', limitUpCount: 2 },
    { code: 'C2', sector: '中档', limitUpCount: 1 },
    { code: 'C3', sector: '中档', limitUpCount: 1 },
  ] };
  const themePersistOf = new Function('S', 'THEME_RULES',
    [grab(/function themeKeyOf\(z\) \{/), grab(/function themePersistOf\(theme\) \{/), 'return themePersistOf;']
      .join('\n'))(S, []); // THEME_RULES=[] → themeKeyOf 退回 sector 名，便于可控构造主题

  const hi = themePersistOf('新能源');
  ok('新能源：连板票数 4 → contLb=4', hi.contLb === 4, hi.contLb);
  ok('新能源：最高板 4 → maxLb=4', hi.maxLb === 4, hi.maxLb);
  ok('新能源：score=4*15+3*5+10=85 → 持久度 高', hi.grade === '高', hi.score + '/' + hi.grade);

  const mid = themePersistOf('中档');
  ok('中档：1 连板 + 3 家 → score=15+5+5=25 → 持久度 中', mid.grade === '中', mid.score + '/' + mid.grade);

  const lo = themePersistOf('冷门');
  ok('冷门：单票首板 → score=0 → 持久度 低', lo.grade === '低', lo.score + '/' + lo.grade);

  const none = themePersistOf('不存在');
  ok('空主题 → 持久度 低（不报错、不冒充）', none.grade === '低' && none.contLb === 0, none.grade);
}

// ---------- ② inferZTProb：情绪乘权 + 字段附加 ----------
console.log('\n【② inferZTProb：情绪乘权(非降门槛) + theme/persist 字段】');
{
  const mk = (moodVar) => new Function('S', 'THEME_RULES', [
    'const MOOD = ' + JSON.stringify(moodVar) + ';',
    grab(/function themeKeyOf\(z\) \{/),
    grab(/function themeStrengthOf\(z\) \{/),
    grab(/function themePersistOf\(theme\) \{/),
    'function classifySectorRoles(arr){ return {}; }', // 桩：只影响 roleScore，不影响分档口径
    'function marketMood(){ return { advice: MOOD, mood: "偏冷" }; }',
    'function auctionMktGate(up){ return 1; }',        // 桩：隔离市场环境闸，专测情绪闸
    'function numNeutral(k, v){ return v; }',
    grab(/const AUCZT_PROB_CEIL = 45;/),       // h2 轮：末道实测上限封顶依赖它
    grab(/function aucztProbClamp\(p\) \{/),  // 沙箱必须同源注入（漏一个符号=整套崩）
    'const ZT_INFER_PUSH_PROB = 55;',
    grab(/function inferZTProb\(\) \{/),
    'return inferZTProb(S);'
  ].join('\n'));

  const S = {
    auction: { strong: [{ code: 'X1', name: '测试票', sector: '新能源', score: 65, auctionPct: 5, mainInflow: 1e8, why: ['放量'], risk: [], factors: [] }] },
    learn: { buckets: {}, paths: {} },
    breadth: null,
    stocks: [],
    ztPool: [
      { code: 'A1', sector: '新能源', limitUpCount: 2 },
      { code: 'A2', sector: '新能源', limitUpCount: 3 },
    ]
  };

  // score=65 → hy 分段映射 -95+65*2.4=61；h2 轮起末道只做「实测上限 45」封顶（单层标定）
  // ⛔ inferZTProb 不 return，结果落在 S.auction.ztInfers；情绪乘权发生在封顶之前，必须可见
  mk('空仓')(S, []); const pEmpty = S.auction.ztInfers[0].prob;   // 61×0.6≈37（再乘题材梯队）
  mk('观望')(S, []); const pWatch = S.auction.ztInfers[0].prob;   // 61 → 封顶 45
  mk('加仓')(S, []); const pAdd   = S.auction.ztInfers[0].prob;   // 61×1.05≈64 → 封顶 45
  ok('情绪观望 → prob 打到实测上限 45（封顶生效，不虚报 >45）', pWatch === 45, pWatch);
  ok('情绪加仓 → prob 同为 45（上限封顶，不越过 55 闸门）', pAdd === 45, pAdd);
  ok('情绪空仓 → prob 明显低于上限（乘权 0.6 没被抹掉）', pEmpty >= 30 && pEmpty <= 44, pEmpty);
  ok('⛔ 情绪是乘权不是降门槛：空仓 < 观望（加仓≥观望，上限封顶）', pEmpty < pWatch && pAdd >= pWatch, pEmpty + '/' + pWatch + '/' + pAdd);

  mk('观望')(S, []); const o = S.auction.ztInfers[0];
  ok('输出带 theme 字段', o.theme === '新能源', o.theme);
  ok('输出带 themeStrength 字段（强/中/弱）', ['强', '中', '弱'].includes(o.themeStrength), o.themeStrength);
  ok('输出带 themeScore 字段（数值）', typeof o.themeScore === 'number', o.themeScore);
  ok('输出带 persist 字段（高/中/低）', ['高', '中', '低'].includes(o.persist), o.persist);
}

// ---------- ③ buildAuctionAlertMessage：情绪摘要 + 同板块去重 + 持久度排序 ----------
console.log('\n【③ buildAuctionAlertMessage：情绪摘要行 + 同板块去重(≤2) + 持久度优先】');
{
  const buildAuctionAlertMessage = new Function([
    'const ZT_INFER_PUSH_PROB = 55;',
    // ⛔ 2026-10-28 A 方案：auczt 闸门独立成常量，沙箱必须同源注入（漏一个符号=整套崩，已踩过）
    'const AUCZT_PUSH_PROB = 18;',
    'function marketMood(){ return { advice: "减仓", mood: "偏冷" }; }',
    'function auctionFrontRunNote(t){ return ""; }',
    'function pickLogic(x){ return "逻辑"; }',
    'function fusedProb(){ return 0; }',
    'function krowsOf(){ return []; }',
    'function probTag(){ return ""; }',
    'function fuseLine(){ return ""; }',
    grab(/function buildAuctionAlertMessage\(au, manual\) \{/),
    'return buildAuctionAlertMessage;'
  ].join('\n'))();

  const au = {
    time: '09:25:10', validCount: 5, newGateUnknown: 0, globalLeader: null, strong: [], sectors: [],
    ztInfers: [
      // 同一板块「新能源」3 只 → 去重后只留概率最高 2 只（C3、C2），C1 应被丢弃
      { code: 'C1', name: '新能1', prob: 60, auctionPct: 4, reason: '放量', theme: '新能源', themeStrength: '中', themeScore: 30, persist: '中' },
      { code: 'C2', name: '新能2', prob: 70, auctionPct: 5, reason: '放量', theme: '新能源', themeStrength: '中', themeScore: 30, persist: '中' },
      { code: 'C3', name: '新能3', prob: 80, auctionPct: 6, reason: '放量', theme: '新能源', themeStrength: '中', themeScore: 30, persist: '中' },
      // 「锂电池」2 只：B1 持久度高但概率低，B2 持久度低但概率高 → 排序后 B1 应在 B2 前
      { code: 'B1', name: '锂电1', prob: 60, auctionPct: 4, reason: '放量', theme: '锂电池', themeStrength: '强', themeScore: 65, persist: '高' },
      { code: 'B2', name: '锂电2', prob: 95, auctionPct: 9, reason: '放量', theme: '锂电池', themeStrength: '弱', themeScore: 20, persist: '低' },
    ]
  };
  const msg = buildAuctionAlertMessage(au, false);

  ok('正文含市场情绪摘要行', /📊 市场情绪/.test(msg), msg.slice(0, 60));
  ok('情绪摘要标注建议【减仓】', /建议【减仓】/.test(msg));
  ok('涨停推断条目展示板块强度', /板块:/.test(msg));
  ok('涨停推断条目展示题材持久度', /持久度:/.test(msg));

  // 同板块去重：新能源 3 只 → 只留 2 只，C1（概率最低）被丢弃
  ok('⛔ 同板块去重：新能源 C1（概率最低）被丢弃', msg.indexOf('C1') < 0, msg.indexOf('C1'));
  ok('新能源保留 C2、C3', msg.indexOf('C2') >= 0 && msg.indexOf('C3') >= 0);
  ok('锂电池两只都保留', msg.indexOf('B1') >= 0 && msg.indexOf('B2') >= 0);

  // 持久度优先排序：B1(高) 应在 B2(低) 之前
  ok('⛔ 持久度优先：B1(高) 排在 B2(低) 之前', msg.indexOf('B1') < msg.indexOf('B2'),
    msg.indexOf('B1') + ' vs ' + msg.indexOf('B2'));
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_auction_mood_sector: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
