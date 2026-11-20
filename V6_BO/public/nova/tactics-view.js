import { h, section, table, percent } from './ui.js';
import { tactics, demoQuotes, demoMarket, evaluateUniverse, marketPhase, disclaimer } from './data/tactics.js';

const stocks = evaluateUniverse(demoQuotes, demoMarket);
export function phaseLabel() {
  return h('span', {class:'fy-muted'}, '演示环境 · '+marketPhase(demoMarket)+'　'+disclaimer);
}
export function stockTactics(code) {
  const stock = stocks.find(s=>s.quote.code===code);
  if (!stock) return h('p',{class:'fy-muted'},'该股票暂无演示样本');
  const hits = tactics.filter(t=>stock.results[t.id].hit)
    .sort((a,b)=>stock.results[b.id].score-stock.results[a.id].score).slice(0,3);
  const failed = tactics.find(t=>stock.results[t.id].note.startsWith('失效：')) || tactics.find(t=>!stock.results[t.id].hit);
  return section(stock.quote.name+' · '+code,disclaimer,
    h('span',{style:'color:'+(stock.quote.change>0?'#e74e56':stock.quote.change<0?'#25915d':'inherit')},percent(stock.quote.change)),
    hits.map(t=>h('p',{},t.name+' · '+stock.results[t.id].cap)),
    failed && h('p',{class:'fy-muted'},failed.name+' · '+stock.results[failed.id].note));
}
export function tacticsCenter() {
  const details=t=>h('details',{},h('summary',{},t.name),
    h('p',{},'命中条件：'+t.hitRule),h('p',{},'失效条件：'+t.failRule),h('p',{},'学习要点：'+t.learn),
    stocks.filter(s=>s.results[t.id].hit).sort((a,b)=>b.results[t.id].score-a.results[t.id].score)
      .map(s=>h('details',{},h('summary',{},s.quote.name+' · '+s.quote.code+' · '+s.results[t.id].cap),stockTactics(s.quote.code))));
  return section('公开战法库',disclaimer,table([
    {label:'战法',value:details},{label:'家族',key:'family'},{label:'来源',key:'source'},
    {label:'今日命中数',value:t=>stocks.filter(s=>s.results[t.id].hit).length}
  ],tactics));
}
