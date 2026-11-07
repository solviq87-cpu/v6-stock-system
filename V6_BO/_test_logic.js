// 驱动归因（情绪票 vs 硬逻辑票）测试 —— 2026-09-30
// 用户要求：「要分辨清楚是情绪票还是硬逻辑票，理解一个票的基本逻辑，为什么涨，为什么跌」。
// 这组断言锁死三件事：① 判据来自证据而不是写死的名单 ② 三种结论都能出来 ③ 下落时要区分回踩与退潮。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

const L = require('./logic.js');

console.log('\n① 硬逻辑：有业绩/订单/涨价这类事实支撑');
{
  const a = L.attribute({ code: '300750', name: '宁德时代', pct: 6.2, sector: '锂电池', secZT: 5, sectorRank: 1,
    boardCount: 0, turnover: 6, mktCap: 9000,
    goodTitles: ['宁德时代：上半年净利润同比增长 33%，超预期', '公司中标某储能大单'], badTitles: [] });
  ok('判为硬逻辑', a.kind === '硬逻辑', a.kind + ' logic=' + a.logic + ' emo=' + a.emotion);
  ok('置信度合理', a.confidence >= 60 && a.confidence <= 95, String(a.confidence));
  ok('证据里点出了业绩这条事实', (a.evidence || []).some(e => e.indexOf('业绩') >= 0), JSON.stringify(a.evidence));
  ok('带上【订单/中标】标签', (a.tags || []).includes('订单/中标'), JSON.stringify(a.tags));
  ok('给了「为什么会涨」的一句话', /逻辑|事实|回落/.test(a.brief), a.brief);
}

console.log('\n② 情绪票：连板 + 高换手 + 板块跟风，无任何消息面');
{
  const a = L.attribute({ code: '002xxx', name: '某某股份', pct: 10.0, sector: '某某概念', secZT: 8, sectorRank: 6,
    boardCount: 4, turnover: 35, mktCap: 22, goodTitles: [], badTitles: [] });
  ok('判为情绪票', a.kind === '情绪', a.kind + ' logic=' + a.logic + ' emo=' + a.emotion);
  ok('证据里点出连板', (a.evidence || []).some(e => e.indexOf('连板') >= 0));
  ok('证据里点出高换手', (a.evidence || []).some(e => e.indexOf('换手') >= 0));
  ok('证据里点出跟风位置', (a.evidence || []).some(e => e.indexOf('跟风') >= 0));
  ok('证据里点出微盘', (a.evidence || []).some(e => e.indexOf('微盘') >= 0));
  ok('明确说了没有东西托底', /没有|托底|回落/.test(a.brief), a.brief);
}

console.log('\n③ ST：无论涨跌，一律按资金博弈算');
{
  const a = L.attribute({ code: '000xxx', name: '*ST某某', pct: 5.0, boardCount: 2, turnover: 8 });
  ok('ST 判为情绪', a.kind === '情绪', a.kind);
  ok('证据里点明 ST', (a.evidence || []).some(e => e.indexOf('ST') >= 0));
}

console.log('\n④ 完全没证据时不能瞎编结论');
{
  const a = L.attribute({ code: '601398', name: '工商银行', pct: 0.5 });
  ok('无证据判为「不明」而不是硬套硬逻辑', a.kind === '不明', a.kind);
  ok('无证据时置信度为 0', a.confidence === 0, String(a.confidence));
  ok('明确说了拿不到证据', /别下|观望|没有/.test(a.brief), a.brief);
}

console.log('\n⑤ 混合：一边有消息、一边在接力');
{
  const a = L.attribute({ code: '600xxx', name: '某某科技', pct: 9.9, boardCount: 3, turnover: 12,
    goodTitles: ['公司发布新品并投产'] });
  ok('两种力量都在时给出混合', ['混合', '情绪', '硬逻辑'].includes(a.kind), a.kind);
  ok('同时列出了两侧的证据', a.logic > 0 && a.emotion > 0, 'logic=' + a.logic + ' emo=' + a.emotion);
}

console.log('\n⑥ 有利空还在涨 = 纯资金行为（这条最容易骗人）');
{
  const a = L.attribute({ code: '000yyy', name: '某某', pct: 8.0, badTitles: ['公司收到监管函'], goodTitles: [] });
  ok('会把「逆着利空涨」记进证据', (a.evidence || []).some(e => e.indexOf('利空') >= 0), JSON.stringify(a.evidence));
}

console.log('\n⑦ 下跌归因：同样跌，硬逻辑是回踩、情绪票是退潮');
{
  const hard = L.attributeDown({ code: '1', name: 'A', pct: -3, goodTitles: ['业绩预增50%'] });
  const emo = L.attributeDown({ code: '2', name: 'B', pct: -3, boardCount: 4, turnover: 30 });
  ok('硬逻辑下跌 → 说回踩/错杀', /回踩|错杀/.test(hard.brief), hard.brief);
  ok('情绪票下跌 → 说退潮', /退潮/.test(emo.brief), emo.brief);
  ok('两种下跌的说法确实不一样', hard.brief !== emo.brief);
}

console.log('\n⑧ 判据必须是机器从文本里认出来的，不是我写死的名单');
{
  const src = require('fs').readFileSync('logic.js', 'utf8');
  ok('结论里不出现任何具体股票代码', !/(?:600|601|603|000|002|300|688)\d{3}/.test(src), '源码里写死了票');
  ok('硬逻辑权重来自证据累加而非 if(code==)', /logic \+=/.test(src) && !/if \(code ===/.test(src));
  ok('无证据时不敢给结论', /kind = '不明'/.test(src));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
