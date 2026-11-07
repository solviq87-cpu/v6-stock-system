'use strict';
function buildStrategyReport(result) {
  const lines=[];
  lines.push(`市场状态：${result.regime.regime}（进攻 ${result.regime.attackScore} / 防守 ${result.regime.defensiveScore}）`);
  lines.push(`最终评分：${result.finalScore}；风险扣分：${result.riskPenalty}`);
  for (const driver of result.topDrivers||[]) {
    lines.push(`${driver.strategy}：${driver.score}；命中 ${driver.hits.map(h=>h.label).join('、')||'无'}`);
  }
  return lines;
}
module.exports={buildStrategyReport};
