// 守门测试：模拟盘买入整手按板块（2026-10-28）
// 背景：旧 paperBuy 把整手写死 100 股 → 科创板(688/689) 也能买 100 股，而科创板最小申报单位
//   是 200 股起、100 股递增，买 100 股是交易所不接受的无效委托，模拟盘等于记了一笔做不出来的成交。
//   现抽出 paperLotOf：主板/创业板/北交所 = 100 起；科创板 = 200 起。本测试钉死映射 + paperBuy 接线 + 端到端取整。
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}

const SRC_LOT = grab(/^function paperLotOf\(code\) \{/m);
const paperLotOf = new Function(SRC_LOT + '\n; return paperLotOf;')();

console.log('\n=== 模拟盘板块整手守门 ===\n');

// ───────── 1. 板块整手映射 ─────────
ok('科创板 688 开头 → 200 股起', paperLotOf('688001') === 200);
ok('科创板 689 开头 → 200 股起', paperLotOf('689009') === 200);
ok('主板 600 开头 → 100 股起', paperLotOf('600519') === 100);
ok('深市 000 开头 → 100 股起', paperLotOf('000001') === 100);
ok('创业板 300 开头 → 100 股起', paperLotOf('300750') === 100);
ok('创业板 301 开头 → 100 股起', paperLotOf('301000') === 100);
ok('北交所 8 开头 → 100 股起', paperLotOf('830799') === 100);
ok('北交所 43 开头 → 100 股起', paperLotOf('430047') === 100);
ok('北交所 92 开头 → 100 股起', paperLotOf('920002') === 100);

// ───────── 2. paperBuy 接线：按板块整手，不得写死 100 ─────────
const buyIdx = src.indexOf('function paperBuy(');
const buyHead = src.slice(buyIdx, buyIdx + 4000);
ok('paperBuy 用 paperLotOf(c.code) 算整手', /const lot = paperLotOf\(c\.code\);/.test(buyHead));
ok('paperBuy 整手公式用 lot 取整', /const shares = Math\.floor\(budget \/ price \/ lot\) \* lot;/.test(buyHead));
ok('paperBuy 不足一手判定用 shares < lot', /if \(shares < lot\)/.test(buyHead));
ok('paperBuy 不再写死 /100) * 100', !/Math\.floor\(budget \/ price \/ 100\) \* 100/.test(buyHead));

// ───────── 3. 端到端：真实 paperLotOf 复刻买股整手公式 ─────────
const buyShares = (code, budget, price) => { const lot = paperLotOf(code); return Math.floor(budget / price / lot) * lot; };
ok('主板 预算2000/价10 → 200 股', buyShares('600000', 2000, 10) === 200);
ok('科创板 预算1000/价10 → 0 股（不足200起，跳过）', buyShares('688001', 1000, 10) === 0);
ok('科创板 预算4000/价10 → 400 股（200起/100递增）', buyShares('688001', 4000, 10) === 400);
ok('科创板 预算4500/价10 → 400 股（取整到400，非450）', buyShares('688001', 4500, 10) === 400);
ok('主板 预算1990/价10 → 100 股（取整到整手，非199）', buyShares('600000', 1990, 10) === 100);

console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
process.exit(fail ? 1 : 0);
