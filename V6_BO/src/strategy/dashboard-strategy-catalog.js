'use strict';
// Read-only adapter for V6 scanUniverse() results. No fabricated picks.
// A strategy with no matched stock returns []; never reuse another strategy's picks.
const pack=require('../../strategies/a-share-strategy-pack.json');
const books=require('../../strategies/research-playbooks.json');
const patterns=[['red_three_soldiers','红三兵'],['three_black_crows','三只乌鸦'],['bullish_engulfing','看涨吞没'],['bearish_engulfing','看跌吞没'],['hammer_rebound','下跌后锤头线'],['shooting_star','上涨后射击之星'],['morning_star','早晨之星'],['evening_star','黄昏之星'],['ma5_ma20_volume','MA5/MA20金叉放量'],['breakout20_liquid','20日新高放量突破'],['high_tight_flag','高位旗形缩量整理'],['momentum20_above_ma50','20日动量强于50日线'],['breakdown20_volume','20日低点放量破位'],['heavy_distribution','放量长阴'],['ma5_ma20_death_cross','MA5/MA20死叉'],['limit_up_shakeout_main','主板涨停后洗盘候选'],['support_stabilization','缩量支撑企稳候选'],['rps120_breakout','RPS120强势接近新高']];
const catalog=[
 ...pack.strategies.map(x=>({id:'base:'+x.name,label:x.name,group:'基础评分策略',status:'active'})),
 ...books.playbooks.map(x=>({id:'playbook:'+x.id,label:x.label,group:'研究战法',status:'active'})),
 ...patterns.map(([id,label])=>({id:'pattern:'+id,label,group:'K线形态',status:'active'})),
 ...[['donchian20_atr','Donchian20/10＋ATR'],['rsi2_mean_reversion','RSI2顺势回归'],['momentum20_rotation','20日动量TopK轮动']].map(([id,label])=>({id:'research:'+id,label,group:'完整策略研究',status:'browser-research'})),
 ...[['vnpy_boll_cci','布林＋CCI＋ATR'],['vnpy_atr_rsi','ATR＋RSI'],['dual_momentum','月度双动量']].map(([id,label])=>({id:'planned:'+id,label,group:'待验证策略',status:'not-integrated'}))
];
const known=new Set(catalog.map(x=>x.id));
function matchedIds(item={}){
 const out=new Set();
 for(const s of item.strategy?.strategies||item.strategies||[])if(s?.pass&&s.name)out.add('base:'+s.name);
 for(const s of item.strategy?.playbookAnalysis?.playbooks||item.playbookAnalysis?.playbooks||[])if(s?.status==='candidate')out.add('playbook:'+s.id);
 for(const s of item.patterns?.checks||[])if(s?.status==='matched')out.add('pattern:'+s.id);
 for(const s of item.researchStrategies||[])if(s?.status==='matched')out.add('research:'+s.id);
 return [...out].filter(x=>known.has(x));
}
function projectStrategyStocks(scan={},id){
 if(!known.has(id))throw RangeError('unknown strategy id');
 return (Array.isArray(scan.items)?scan.items:[]).filter(x=>matchedIds(x).includes(id)).map(x=>({
  symbol:String(x.symbol||x.code||''),name:String(x.name||''),score:Number.isFinite(x.score)?x.score:null,
  asOf:x.patternDate||x.quality?.timestamp||null,
  dataStatus:x.quality?.fresh===true?'fresh':x.quality?.usable===true?'unverified-or-stale':'unavailable',
  tradable:x.tradable===true
 }));
}
module.exports={catalog,matchedIds,projectStrategyStocks};
