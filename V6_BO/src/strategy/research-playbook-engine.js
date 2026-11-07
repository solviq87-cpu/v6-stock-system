'use strict';
const catalog=require('../../strategies/research-playbooks.json');
const {barsToIndicators}=require('./historical-indicators');
const {classifyLimitLadder}=require('./limit-ladder-engine');
const isScore=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
function evaluatePlaybooks(stock={}){
 const bars=stock.bars,ind=barsToIndicators(bars),out=[];
 const last=Array.isArray(bars)?bars.at(-1):null;
 const previous=Array.isArray(bars)?bars.at(-2):null;
 const volRatio=ind.valid?ind.volumeRatio:null;
 const ladder=ind.valid?classifyLimitLadder(stock):{eligible:false};
 const add=(id,eligible,reason,missing=[])=>out.push({id,label:catalog.playbooks.find(p=>p.id===id).label,
   status:missing.length?'insufficient_data':eligible?'candidate':'not_matched',reason,missing,autoTrade:false});
 const history=ind.valid&&ind.bars>=27;
 const missingBars=history?[]:['至少27根有效历史K线'];
 add('platform_breakout',history&&ind.breakout20&&volRatio!==null&&volRatio>=1.5,'20日收盘突破且量比不低于1.5',missingBars);
 add('trend_pullback',history&&ind.ma5>ind.ma10&&ind.ma10>ind.ma20&&last&&last.close>=ind.ma10&&last.close<=ind.ma5*1.03&&volRatio!==null&&volRatio<1,'均线多头且回踩缩量',missingBars);
 add('momentum_acceleration',history&&ind.ma5>ind.ma10&&ind.macd.hist>0&&ind.rsi14>=55&&ind.rsi14<=80,'趋势、MACD和RSI共振',missingBars);
 add('low_vol_quality',history&&isScore(stock.lowVolatilityScore)&&isScore(stock.roeQualityScore)&&stock.lowVolatilityScore>=70&&stock.roeQualityScore>=65,'低波动和盈利质量评分达标',missingBars.concat(['lowVolatilityScore','roeQualityScore'].filter(k=>!isScore(stock[k]))));
 add('first_board_quality',ladder.stage==='首板'&&isScore(stock.sealQualityScore)&&stock.sealQualityScore>=70,'首板与封板质量',missingBars.concat(isScore(stock.sealQualityScore)?[]:['sealQualityScore']));
 add('first_to_second',ladder.streak===1&&isScore(stock.auctionQualityScore)&&isScore(stock.sectorHeatScore)&&stock.auctionQualityScore>=65&&stock.sectorHeatScore>=65,'首板后的竞价承接与板块热度',missingBars.concat(['auctionQualityScore','sectorHeatScore'].filter(k=>!isScore(stock[k]))));
 add('second_to_third',ladder.streak===2&&isScore(stock.auctionQualityScore)&&isScore(stock.promotionScore)&&stock.auctionQualityScore>=70&&stock.promotionScore>=70,'二板后的竞价与晋级质量',missingBars.concat(['auctionQualityScore','promotionScore'].filter(k=>!isScore(stock[k]))));
 add('reseal_strength',isScore(stock.resealScore)&&isScore(stock.sealQualityScore)&&stock.resealScore>=70&&stock.sealQualityScore>=70,'回封及封板评分达标',['resealScore','sealQualityScore'].filter(k=>!isScore(stock[k])));
 add('leader_sector',isScore(stock.leaderStrengthScore)&&isScore(stock.sectorHeatScore)&&stock.leaderStrengthScore>=75&&stock.sectorHeatScore>=70,'龙头辨识度与板块共振',['leaderStrengthScore','sectorHeatScore'].filter(k=>!isScore(stock[k])));
 add('money_flow_continuation',isScore(stock.moneyPersistenceScore)&&isScore(stock.fundFlowScore)&&stock.moneyPersistenceScore>=70&&stock.fundFlowScore>=65,'资金持续性和资金强度',['moneyPersistenceScore','fundFlowScore'].filter(k=>!isScore(stock[k])));
 return {symbol:stock.symbol||stock.code||'',indicatorsValid:ind.valid,playbooks:out,matched:out.filter(x=>x.status==='candidate').length,
  note:'候选研究信号，非买卖建议；数据不足不推断'};
}
module.exports={evaluatePlaybooks};
