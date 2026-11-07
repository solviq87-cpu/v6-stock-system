'use strict';
function applyRiskFilter(s={}) {
  const reasons=[];
  if (s.isST) reasons.push('ST/风险标的');
  if (s.suspended) reasons.push('停牌');
  if (s.tradable===false) reasons.push('当前不可交易');
  if (Number(s.amount||0)>0 && Number(s.amount)<5e6) reasons.push('成交额流动性不足');
  if (Number(s.riskScore||0)>=85) reasons.push('综合风险过高');
  const hardBlock=reasons.some(x=>/ST|停牌|不可交易|风险过高/.test(x));
  return {pass:!hardBlock,reasons,hardBlock};
}
module.exports={applyRiskFilter};
