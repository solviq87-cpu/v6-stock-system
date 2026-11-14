// 📰 新闻利好/利空分类 单测（_test_news_kw.js）
// 背景：2026-09-29 用户报错「光莆明明是利空」——「光莆股份：公司拟出售不超过610.36万股
//   已回购股份」命中利好词「回购」被标利好；实际是把回购的股份抛向市场 = 变相减持 = 利空。
// 修复：语义反转组合规则 NEWS_BAD_PATTERNS（优先级压过利好词）+ 存量归档自动修复。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
function sec(t) { console.log('\n' + t); }

// ── 镜像 server.js 的判定（与源码保持一致） ─────────────
const NEWS_BAD_PATTERNS = [
  /出售.{0,20}已?回购股份/,
  /回购股份.{0,6}(出售|减持|解禁)/,
  /回购.{0,8}股份.{0,8}拟?出售/,
];
const NEWS_BAD_KW = ['利空', '减持', '质押', '立案', '留置', '调查', '处罚', '罚款', '警示函', '监管函', '问询函', '退市', '预亏', '首亏', '亏损', '业绩变脸', '商誉减值', '减值', '终止上市', '退市风险', '违约', '爆雷', '暴雷', '诉讼', '仲裁', '冻结', '召回', '裁员', '关税', '制裁', '禁令', '跌停', '跌超', '大跌', '跳水', '流出', '做空', '沽空', '风险提示', '安全事故', '爆炸', '火灾', '失联', '被查', '被拘', '拘留', '通报批评', '失信', '被执行', '下调评级', '下调目标价', '解除合同', '失去', '到期违约'];
const NEWS_GOOD_KW = ['利好', '中标', '签订', '签署', '合同', '订单', '预增', '扭亏', '净利润增', '获批', '获准', '核准', '收购', '并购', '重组', '回购', '增持', '分红', '派息', '战略合作', '框架协议', '涨价', '提价', '上调评级', '上调目标价', '超预期', '涨停', '大涨', '创新高', '试点', '政策支持', '扶持', '补贴', '减税', '降准', '降息', '突破', '景气', '大单', '里程碑'];
function newsIsBad(title, summary) {
  const text = (title || '') + (summary || '');
  if (NEWS_BAD_PATTERNS.some(r => r.test(text))) return true;
  return NEWS_BAD_KW.some(k => text.includes(k));
}
function classify(title, summary) {
  if (newsIsBad(title, summary)) return 'bad';
  if (NEWS_GOOD_KW.some(k => (title + '').includes(k) || (summary + '').includes(k))) return 'good';
  return 'neutral';
}

// ── ① 用户报错案例：出售已回购股份 = 利空（语义反转压过「回购」利好词） ──
sec('① 光莆案例：出售已回购股份 → 利空');
ok(classify('光莆股份：公司拟出售不超过610.36万股已回购股份', '') === 'bad', '原始标题 → bad');
ok(classify('XX公司拟出售不超过500万股已回购股份', '') === 'bad', '同构标题 → bad');
ok(classify('公司对已回购股份拟予出售', '') === 'bad', '语序变化 → bad');
ok(classify('公司回购股份将予以出售注销', '') === 'bad', '回购股份…出售 → bad');

// ── ② 不误伤：正常回购/资产处置仍是原分类 ──
sec('② 不误伤：正常利好/中性不受影响');
ok(classify('光莆股份：公司拟回购不超过2亿元股份', '') === 'good', '正常回购 → good');
ok(classify('公司已完成回购，累计回购股份500万股', '') === 'good', '回购完成 → good');
ok(classify('子公司出售资产实现收益3000万元', '') === 'neutral', '出售资产(无回购股份) 不触发组合规则');
ok(classify('公司签订日常经营重大合同', '') === 'good', '签合同 → good');
ok(classify('公司发布年度报告', '') === 'neutral', '普通播报 → neutral');

// ── ③ 原有利空词不受影响 ──
sec('③ 原有利空词表正常工作');
ok(classify('股东拟减持不超过3%公司股份', '') === 'bad', '减持 → bad');
ok(classify('公司收到监管函', '') === 'bad', '监管函 → bad');
ok(classify('预计半年度净利润亏损', '') === 'bad', '亏损 → bad');

// ── ④ 存量归档修复逻辑（镜像 repairNewsClassify） ──
sec('④ repairNewsClassify：错分条目从利好改判利空');
const DB = {
  badAll: [{ id: 'b1', t: '2026-09-29 10:00:00', title: '老利空', summary: '' }],
  goodAll: [
    { id: 'g1', t: '2026-09-29 09:00:00', title: '光莆股份：公司拟出售不超过610.36万股已回购股份', summary: '' },
    { id: 'g2', t: '2026-09-29 09:05:00', title: '公司拟回购不超过2亿元股份', summary: '' },
  ],
  neutralAll: [{ id: 'n1', t: '2026-09-29 08:00:00', title: '出售已回购股份相关讨论', summary: '' }],
  goodPushed: new Set(['g1', 'g2']),
};
const _isBad = x => newsIsBad(x.title, x.summary);
let fixed = 0;
const _badIds = new Set(DB.badAll.map(x => x.id));
const pullBad = list => {
  const keep = [];
  for (const x of (list || [])) {
    if (_isBad(x)) { if (!_badIds.has(x.id)) { DB.badAll.push(x); _badIds.add(x.id); } fixed++; }
    else keep.push(x);
  }
  return keep;
};
DB.goodAll = pullBad(DB.goodAll);
DB.neutralAll = pullBad(DB.neutralAll);
if (fixed) for (const x of DB.badAll) DB.goodPushed.delete(x.id);
ok(fixed === 2, '修复 2 条（光莆g1 + 中性n1）', 'fixed=' + fixed);
ok(DB.goodAll.length === 1 && DB.goodAll[0].id === 'g2', 'goodAll 只剩正常回购条目');
ok(DB.badAll.length === 3 && DB.badAll.some(x => x.id === 'g1') && DB.badAll.some(x => x.id === 'n1'), 'badAll 收纳两条错分条目');
ok(!DB.goodPushed.has('g1'), '错分条目的「已推」标记已清（不再占坑）');
// 幂等：再跑一遍零改动
fixed = 0;
DB.goodAll = pullBad(DB.goodAll); DB.neutralAll = pullBad(DB.neutralAll);
ok(fixed === 0, '再跑一遍零改动（幂等）');

// ── ⑤ 源码接线检查 ──
sec('⑤ 源码接线检查');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const web = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
ok(src.indexOf('NEWS_BAD_PATTERNS') >= 0, '语义反转规则表已定义');
ok(src.indexOf('出售.{0,20}已?回购股份') >= 0, '光莆案例正则在位');
ok(src.indexOf('function newsIsBad(') >= 0, '利空判定唯一入口 newsIsBad');
ok(src.indexOf('const isBad = newsIsBad(title, summary)') >= 0, 'classifyNews 改用统一入口');
ok(src.indexOf('if (newsIsBad(title, summary)) continue;') >= 0, 'classifyNeutral 改用统一入口');
ok(src.indexOf('function repairNewsClassify()') >= 0, '存量归档修复函数已定义');
ok(src.indexOf('repairNewsClassify();') >= 0, '启动时先修复再播种已接线');
ok(src.indexOf('goodPushed.delete(x.id)') >= 0, '修复时清「已推」标记');
ok(!/NEWS_BAD_KW\.some\(k => title\.includes\(k\) \|\| summary\.includes\(k\)\)/.test(src), '不再绕过入口直接查词表');
const sv = (src.match(/const APP_VER = '([^']+)'/) || [])[1];
const wv = (web.match(/const APP_VER = '([^']+)'/) || [])[1];
// ⚠️ 别写死具体版本号：每次发版都要回来改，不改就红。
  // 这条真正要守的是"两端一致"（不一致前端会无限 reload）与"格式合法"。
  ok(sv === wv && /^\d{8}[a-z]{2}$/.test(sv), 'APP_VER 两端一致且格式合法（' + sv + ' vs ' + wv + '）');

console.log('\n──────────────────────────────');
console.log(`结果: ${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
process.exit(fail ? 1 : 0);
