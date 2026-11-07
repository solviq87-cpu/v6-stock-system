// 守门：jf 轮「个股资金流聚合板块流」辅助校验源
const fs = require('fs');
const srvSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

sec('① 辅助校验源函数与状态位存在');
{
  ok(/function aggregateSectorFlowFromStocks\(\)/.test(srvSrc), 'aggregateSectorFlowFromStocks 函数存在');
  ok(/S\.sectorsAlt/.test(srvSrc), 'S.sectorsAlt 状态位存在');
  ok(/aggregateSectorFlowFromStocks\(\)/.test(srvSrc), 'refreshSectorsZT 调用聚合函数');
}

sec('② 聚合逻辑正确性（源码断言）');
{
  const fn = srvSrc.match(/function aggregateSectorFlowFromStocks\(\) \{[\s\S]*?\n\}/);
  ok(!!fn, '函数体可提取');
  if (fn) {
    const body = fn[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    ok(/sectorOfStock\(\{ code: s\.code, name: s\.name \}\)/.test(body), '用四层归属算板块名');
    ok(/s\.mainInflow/.test(body), '优先用个股主力净流入（EM 口径）');
    ok(/s\.thsNetAmt/.test(body), '兜底用同花顺主动净买');
    ok(/mainInflow/.test(body), '输出板块 mainInflow');
    ok(/sort\(\(a, b\) => b\.mainInflow - a\.mainInflow\)/.test(body), '按净流入降序');
  }
}

sec('③ 交叉校验日志存在');
{
  ok(/东财Top10与个股聚合Top10重叠/.test(srvSrc), '有 Top10 重叠度校验日志');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
