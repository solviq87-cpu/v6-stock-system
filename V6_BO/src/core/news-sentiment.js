'use strict';
// Bounded, explainable heuristics over the provider text. No truth or return probability claim.
const NEWS_BAD_KW = ['利空', '减持', '质押', '立案', '留置', '调查', '处罚', '罚款', '警示函', '监管函', '问询函', '退市', '预亏', '首亏', '亏损', '业绩变脸', '商誉减值', '减值', '终止上市', '退市风险', '违约', '爆雷', '暴雷', '诉讼', '仲裁', '冻结', '召回', '裁员', '关税', '制裁', '禁令', '跌停', '跌超', '大跌', '跳水', '流出', '做空', '沽空', '风险提示', '安全事故', '爆炸', '火灾', '失联', '被查', '被拘', '拘留', '通报批评', '失信', '被执行', '下调评级', '下调目标价', '解除合同', '失去', '到期违约'];
const NEWS_GOOD_KW = ['利好', '中标', '签订', '签署', '合同', '订单', '预增', '扭亏', '净利润增', '获批', '获准', '核准', '收购', '并购', '重组', '回购', '增持', '分红', '派息', '战略合作', '框架协议', '涨价', '提价', '上调评级', '上调目标价', '超预期', '涨停', '大涨', '创新高', '试点', '政策支持', '扶持', '补贴', '减税', '降准', '降息', '突破', '景气', '大单', '里程碑'];
const VERSION = 'news-context-v1';
const NEWS_BAD_PATTERNS = [
  /出售.{0,20}已?回购股份/,
  /回购股份.{0,6}(出售|减持|解禁)/,
  /回购.{0,8}股份.{0,8}拟?出售/
];
const CANCEL_POSITIVE = /(?:终止|取消|暂停|放弃|不再|未能)(?:实施|推进|筹划|进行|完成|继续|公司|本次|股份|计划|重大资产|的){0,4}(?:回购|增持|收购|并购|重组|分红|派息|订单|合同)/;
const FAILED_APPROVAL = /(?:申请|项目|方案|重组|并购|收购|回购).{0,12}(?:被否决|未获批准|未获批|未通过)/;
// Mask only the relieved event, never the whole article: a cancelled reduction
// can coexist with a new investigation in the next clause.
const RELIEF = [
  /(?<!未|不)(?:终止|取消|不再)(?:计划)?出售.{0,20}已?回购股份/g,
  /(?:不|不会)减持/g,
  /(?<!未|不)(?:终止|取消|不再|未实施|尚未实施|未进行)(?:实施|继续|本次|股份|计划|的){0,3}减持(?:计划)?/g,
  /减持(?:计划)?(?:已)?(?:终止|取消)/g,
  /(?<!未|不)解除(?:部分|全部)?(?:股份)?(?:质押|冻结)/g,
  /(?:股份)?(?:质押|冻结)(?:已)?解除/g,
  /(?:未被|没有被|未受到|未收到|未遭到)(?:立案调查|立案|调查|处罚|监管函|警示函|问询函)/g,
  /(?:未发生|不存在|没有发生|未出现)(?:债务|债券|重大)?(?:违约|亏损|诉讼|安全事故|火灾|爆炸)/g,
  /(?:不会|不进行|不实施|暂无)(?:股份)?回购/g,
  /(?:不涉及|不存在|没有|未筹划)(?:重大资产)?(?:收购|并购|重组|回购|增持|分红|派息)/g
];
const UNCERTAIN = /传闻|传言|网传|据传|谣言|辟谣|否认|澄清|尚未证实|未经证实|待核实|不属实|尚未获批|尚未批准/;
const PRICE_ONLY = new Set(['涨停','大涨','创新高','突破','大单','里程碑']);
function assessNews(title, summary) {
  if (typeof title !== 'string' || typeof summary !== 'string' || title.length > 1000 || summary.length > 50000)
    return {version:VERSION,type:'neutral',status:'unknown',why:'待核实：新闻文本缺失或超出范围',matched:[],notes:['INVALID_TEXT']};
  const bad = new Set(), good = new Set(), notes = new Set();
  let reversal = false;
  // Separating title/body prevents a pattern from crossing their boundary.
  for (let clause of (title + '\n' + summary).split(/[，,。；;！？!?\n]|但是|但|然而|并且|同时|以及|并(?!购)/)) {
    if (!clause) continue;
    if (UNCERTAIN.test(clause)) { notes.add('UNCONFIRMED_OR_DENIED'); continue; }
    for (const re of RELIEF) {
      clause = clause.replace(re, () => { notes.add('RELIEVED_OR_NEGATED_EVENT'); return ' '; });
    }
    if (NEWS_BAD_PATTERNS.some(re => re.test(clause))) { reversal = true; bad.add('出售已回购股份'); }
    const cancelled = clause.match(CANCEL_POSITIVE) || clause.match(FAILED_APPROVAL);
    if (cancelled) { reversal = true; bad.add(cancelled[0]); }
    for (const kw of NEWS_BAD_KW) if (clause.includes(kw)) bad.add(kw);
    for (const kw of NEWS_GOOD_KW) if (clause.includes(kw)) {
      if (PRICE_ONLY.has(kw)) notes.add('PRICE_OR_GENERIC_WORD_ONLY');
      else good.add(kw);
    }
  }
  // A denial/rumour anywhere blocks positive promotion, while a separately
  // stated negative event remains a warning. This intentionally favours review.
  const type = bad.size ? 'bad' : good.size && !notes.has('UNCONFIRMED_OR_DENIED') ? 'good' : 'neutral';
  const matched = [...(type === 'bad' ? bad : type === 'good' ? good : [])].slice(0, 8);
  const why = type === 'bad' ? (reversal ? '规则判为利空（语义反转）: ' : '规则判为利空: ') + matched.slice(0, 3).join('、')
    : type === 'good' ? '规则判为利好: ' + matched.slice(0, 3).join('、')
    : notes.has('UNCONFIRMED_OR_DENIED') ? '中性待核实：含传闻、否认或澄清，不作利好加分'
    : notes.has('RELIEVED_OR_NEGATED_EVENT') ? '中性：相关事件已否定或解除，不自动认定利好'
    : '中性：仅信息播报或价格表现，无明确消息催化';
  return {version:VERSION,type,status:'heuristic',why,matched,notes:[...notes]};
}
// Three China calendar days (today plus two prior days), not host-local dates
// or receipt time. Unknown/future source timestamps cannot become live signals.
function newsIsCurrent(publishedAt, now = Date.now()) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(publishedAt) || publishedAt < 946684800000 || publishedAt > now) return false;
  const day = t => Math.floor((t + 8 * 3600000) / 86400000);
  return day(publishedAt) >= day(now) - 2;
}
module.exports = { VERSION, NEWS_BAD_KW, NEWS_GOOD_KW, NEWS_BAD_PATTERNS, assessNews, newsIsCurrent };
