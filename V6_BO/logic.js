// 驱动归因：这只票到底是【硬逻辑】在涨，还是【情绪】在推？（2026-09-30 新增）
//
// 用户的原话：「要分辨清楚是情绪票还是硬逻辑票，理解一个票的基本逻辑，为什么涨，为什么跌」。
// 以前系统只会报「某某板块有几只涨停、某某涨了 X%」—— 全是**现象**，没有一个字讲**原因**。
// 这个模块只做一件事：把手边能拿到的一切证据摆在一起，给这只票一个「为什么会这样」的答复，
// 并且明确区分两种完全不同的上涨：
//
//   【硬逻辑】业绩/订单/涨价/政策/重组 —— 上涨背后有可验证的事实支撑，回落也有底；
//   【情绪票】游资接力/板块跟风/纯资金推动 —— 涨得凶，但支撑它的是"还有人愿意接"，容易A字回落。
//
// 判别不靠人工写规则名单（那是"喂数据"），而是把证据分两侧打分：
//   逻辑侧 +证据 / 情绪侧 +证据，最后看哪边压得住。每条结论都必须能附上证据，不许凭感觉下判断。

// ── 硬逻辑信号：这些词出现在与该股相关的新闻/公告标题里，才算「有事实支撑」 ───────────
const LOGIC_PATTERNS = [
  { re: /业绩预增|业绩预喜|净利.*增|净利润.*增|扭亏|中报.*增|年报.*增|三季报.*增|半年报.*增|毛利.*增/, tag: '业绩增长', w: 3 },
  { re: /中标|订单|合同.*签|采购协议|框架协议|大额合同|在手订单/, tag: '订单/中标', w: 3 },
  { re: /涨价|提价|价格上调|出厂价.*涨|报价.*涨|涨价函/, tag: '产品涨价', w: 3 },
  { re: /政策|规划|补贴|支持.*发展|试点|牌照|准入|标准.*发布|国常会|会议.*部署/, tag: '政策催化', w: 2.5 },
  { re: /收购|重组|并购|资产注入|控制权.*变更|要约/, tag: '资产重组', w: 3 },
  { re: /回购|增持|股权激励/, tag: '回购/增持', w: 2 },
  { re: /投产|扩产|产能.*释放|新品|量产|良率|突破|量产交付|供货/, tag: '产能/新品', w: 2.5 },
  { re: /预收|合同负债.*增|现金流.*改善|roe|净资产收益/, tag: '财务改善', w: 1.5 },
  { re: /机构调研|北向|北上资金.*加|基金.*加仓|社保.*新进|外资.*增持/, tag: '机构动向', w: 2 }
];
const SPEC_RE = /ST|退|\*ST/i;

function _hit(list, re) {
  for (const s of list || []) {
    const t = String((s && (s.title || s.text || s.summary)) || s || '');
    if (re.test(t)) return t.slice(0, 40);
  }
  return '';
}

/**
 * 给一只票做驱动归因。
 * @param {Object} x 需要的字段都是可选的，给什么就用什么 —— 缺证据时结论会保守，不会瞎编。
 *   code, name, pct（当日涨幅）, rows（K线，可选）,
 *   boardCount（连板数，0/1/2…）, secZT（所属板块涨停家数）, sectorRank（自己在板块内的位置,1=最强）,
 *   sector, turnover（换手率%）, amount（成交额）, goodTitles[]（利好标题）, badTitles[]（利空标题）,
 *   bigMoney（大单净额，可正可负）, mktCap（流通市值，亿）
 * @returns {{kind:string, confidence:number, logic:number, emotion:number, evidence:string[], brief:string, tags:string[]}}
 */
function attribute(x) {
  x = x || {};
  const evidence = [], tags = [];
  let logic = 0, emotion = 0;
  const good = x.goodTitles || [];
  const bad = x.badTitles || [];

  // ① 事实侧：新闻/公告里能找到「发生了什么」，这是硬逻辑唯一的来源
  for (const p of LOGIC_PATTERNS) {
    const hit = _hit(good, p.re);
    if (hit) { logic += p.w; evidence.push(`【${p.tag}】${hit}`); tags.push(p.tag); }
  }
  // ② 位置：板块主线里的最强票通常自带资金认可；跟风的第 N 名往往是情绪外溢
  const secZT = Number(x.secZT) || 0, rank = Number(x.sectorRank) || 0;
  if (secZT >= 3) {
    if (rank > 0 && rank <= 2) { logic += 1.5; evidence.push(`【板块主线】${x.sector || '该板块'}今日${secZT}只涨停，它排第${rank}`); }
    else if (rank >= 4) { emotion += 1.5; evidence.push(`【跟风】板块${secZT}只涨停，它只排第${rank}（涨是别人带的）`); }
  }
  // ③ 连板：2 板以上是明确的情绪接力（板数越高，接力的比重越大）
  const bc = Number(x.boardCount) || 0;
  if (bc >= 3) { emotion += 3.5; evidence.push(`【情绪接力】已是${bc}连板，靠资金接力维持`); }
  else if (bc === 2) { emotion += 2; evidence.push(`【情绪接力】2连板，接力资金主导`); }
  else if (bc === 1 && logic > 0) { logic += 0.5; evidence.push('【首板+有事实】首个涨停且有消息面支撑'); }
  // ④ 换手：换手率畸高说明筹码在高频换手（典型短线资金盘）
  const to = Number(x.turnover) || 0;
  if (to >= 25) { emotion += 2.5; evidence.push(`【高换手】换手${to}%，筹码在高频易手`); }
  else if (to >= 12 && to < 25) { emotion += 1; evidence.push(`【偏活跃】换手${to}%`); }
  // ⑤ 特种品种：ST 几乎一律是资金博弈
  if (SPEC_RE.test(String(x.name || ''))) { emotion += 3; evidence.push('【ST】涨跌幅受限+无基本面支撑，纯资金博弈'); }
  // ⑥ 利空压制：有利空还在涨 = 纯资金行为；有利空且跌 = 归因明确
  if (bad.length) {
    const b0 = String(bad[0] || '').slice(0, 40);
    if ((Number(x.pct) || 0) > 0) { emotion += 1.5; evidence.push(`【逆着利空涨】${b0}`); }
    else { logic += 0; emotion += 0; evidence.push(`【利空兑现】${b0}`); }
  }
  // ⑦ 成交额与盘子：小盘子+小成交额更容易被资金控盘
  const cap = Number(x.mktCap) || 0;
  if (cap > 0 && cap < 30) { emotion += 1; evidence.push(`【微盘】流通${cap}亿，容易被资金拉动`); }

  // ⑧ 结论：两侧比分说话 —— 任何一方压不住对方时判「混合」，不许硬套
  const diff = logic - emotion;
  let kind = '混合', conf = 40;
  if (diff >= 2.5) { kind = '硬逻辑'; conf = Math.min(95, 55 + Math.round(diff * 8)); }
  else if (diff <= -2.5) { kind = '情绪'; conf = Math.min(95, 55 + Math.round(-diff * 8)); }
  else { conf = 45 + Math.round(Math.abs(diff) * 5); }
  if (!evidence.length) { kind = '不明'; conf = 0; }

  // ⑨ 一句「为什么会这样」——必须是从上面的证据里得出的，不是模板套话
  let brief = '';
  if (kind === '硬逻辑') {
    brief = `这波上涨有事实兜底：${tags.slice(0, 2).join('、') || '消息面支撑'}。回落通常有承接，跟踪点在消息是否兑现。`;
  } else if (kind === '情绪') {
    brief = `推动它的是资金不是事实（${bc >= 2 ? bc + '连板、' : ''}${to >= 20 ? '换手' + to + '%、' : ''}${rank >= 4 ? '板块内排第' + rank : '跟风'}）。没有兑现的东西托底，一旦接力断档回落很快。`;
  } else if (kind === '混合') {
    brief = `一半靠消息（${tags[0] || '有' + logic.toFixed(1) + '分证据'}）、一半靠资金接力。消息兑现跟不上就会回吐情绪那部分。`;
  } else {
    brief = '手上暂时拿不到它的任何消息面证据 —— 结论先别下，等有新闻进来再判。';
  }

  return { kind, confidence: conf, logic: +logic.toFixed(1), emotion: +emotion.toFixed(1), evidence: evidence.slice(0, 4), brief, tags: tags.slice(0, 3) };
}

// 下跌归因：逻辑侧够硬的下跌，往往是「错杀/回踩」；情绪票的下跌就是「退潮」
function attributeDown(x, attr) {
  const a = attr || attribute(x);
  if (a.kind === '硬逻辑')
    return { ...a, brief: `跌的时候逻辑还在（${(a.tags || [])[0] || '有支撑'}），更像回踩或错杀；若跌破关键均线且消息被证伪，逻辑就要重估。` };
  if (a.kind === '情绪')
    return { ...a, brief: `这是退潮：前面靠资金推上去的，现在资金走了，没有东西托着。别用"基本面没问题"自我安慰——它本来就没基本面。` };
  return { ...a, brief: '缺足够证据判断这次涨跌的性质，观望。' };
}

module.exports = { attribute, attributeDown, LOGIC_PATTERNS };
