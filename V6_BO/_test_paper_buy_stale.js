// 守门测试：模拟盘「买入端价格新鲜度」+「副本不按本地流水重建持仓」+「修复持仓的留痕不许撒谎」
// （2026-10-28，持仓与模拟盘空间）
//
// 为什么要有这一份：
//   ① 买卖两端对「价格新鲜度」的要求**不对称**——卖出端早就写着「pm 里没有这只票 = 没观察到真实价
//      → 只记价不卖」（paperCheck 的 live 判定），买入端却只判了 `price > 0`，pm 取不到就退回候选池
//      的 c.price 成交。候选池会陈旧（TTL 缓存 / 隔夜预选 / 全A拉取失败），于是能记出一笔
//      「按几小时前的价买入」的假成交，污染收益率与学习样本。本测试钉死买入端的对称闸。
//   ② 副本的流水是「本地历史 + 线上最近 30 条」的并集，线上重置过之后旧票还留在流水里。
//      拿它当权威重建持仓，会把早已卖掉的票补回账户（本机实测多出 4 只）。副本只许转发线上执行。
//   ③ paperRepairPositions 的修正记录原来在赋值之后才拼字符串，前后永远同值 —— 等于没有记录。
//
// ⛔ 判据方向：这里全部是**代码语义**断言（沙箱真跑 + 源码接线），不依赖本机 paper.json 长什么样。
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// ───────── 0. 函数与登记项必须存在 ─────────
const i0 = SRC.indexOf('function paperPxFresh(');
ok(i0 > 0, 'server.js 里存在 paperPxFresh（买入端价格新鲜度判定）');
const i1 = SRC.indexOf('\n}\n', i0);
const pxSrc = SRC.slice(i0, i1 + 3);

// ───────── 1. paperPxFresh 语义（沙箱真跑） ─────────
const build = (S) => new Function('S', pxSrc + '\n; return paperPxFresh;')(S);
const NOW = 1_700_000_000_000;
// 固定"现在"，避免真实时钟抖动（守门铁律：不许依赖真实时钟）
const realNow = Date.now;
Date.now = () => NOW;
try {
  // 1a tick 新鲜（3 分钟内）
  let f = build({ lastPx: new Map([['600000', { p: 10.5, t: NOW - 60_000 }]]), stocks: [], stocksAt: 0 });
  ok(f('600000') === 10.5, 'tick 价 1 分钟前 → 返回 10.5（新鲜，可成交）');

  // 1b tick 过期（超过 3 分钟）且无快照 → 判不出新鲜 → 0
  f = build({ lastPx: new Map([['600000', { p: 10.5, t: NOW - 4 * 60_000 }]]), stocks: [], stocksAt: 0 });
  ok(f('600000') === 0, 'tick 价 4 分钟前且无全A快照 → 0（陈旧，不许成交）');

  // 1c tick 过期但全A快照新鲜（快照 ≤10 分钟）→ 用快照价
  f = build({
    lastPx: new Map([['600000', { p: 10.5, t: NOW - 4 * 60_000 }]]),
    stocks: [{ code: '600000', price: 10.8 }], stocksAt: NOW - 5 * 60_000
  });
  ok(f('600000') === 10.8, 'tick 过期 + 全A快照 5 分钟前 → 返回快照价 10.8（兜底）');

  // 1d 快照也过期（>10 分钟）→ 0
  f = build({
    lastPx: new Map([['600000', { p: 10.5, t: NOW - 20 * 60_000 }]]),
    stocks: [{ code: '600000', price: 10.8 }], stocksAt: NOW - 11 * 60_000
  });
  ok(f('600000') === 0, 'tick 与全A快照都过期（11 分钟）→ 0（行情断了就不许成交）');

  // 1e 票不在快照里 → 0（不许拿"别的票的价"或候选池价顶上）
  f = build({ lastPx: new Map(), stocks: [{ code: '600519', price: 1500 }], stocksAt: NOW - 60_000 });
  ok(f('600000') === 0, '票不在任何新鲜源里 → 0（不拿候选池/昨收价幻想成交）');

  // 1f 脏数据不许抛异常
  f = build({ lastPx: null, stocks: null, stocksAt: null });
  ok(f('600000') === 0, 'lastPx/stocks 为 null → 0（异常不外抛）');
  f = build({ lastPx: new Map([['600000', { p: 0, t: NOW }]]), stocks: [], stocksAt: 0 });
  ok(f('600000') === 0, '价格为 0 的记录不算新鲜');
} finally { Date.now = realNow; }

// ───────── 2. paperBuy 必须真的用这道闸（接线断言） ─────────
const iBuy = SRC.indexOf('function paperBuy(');
const iBuyEnd = SRC.indexOf('\n}\n', iBuy);
const buySrc = SRC.slice(iBuy, iBuyEnd + 3);
ok(/if \(!paperPxFresh\(c\.code\)\) \{ skipAdd\('buyStalePrice'\); continue; \}/.test(buySrc),
  'paperBuy 在取价之后、算仓位之前就过 paperPxFresh 闸，且跳过原因可上界面');
ok(buySrc.indexOf('paperPxFresh') < buySrc.indexOf('const gross = Math.min(acc.cash'),
  '新鲜度闸在资金计算之前（不许先算完仓位再判价格）');

// ───────── 3. 跳过原因必须登记（skipAdd 对未登记 key 静默丢弃） ─────────
ok(/buyStalePrice:\s*'没有实时行情（陈旧价不成交）'/.test(SRC),
  'SKIP_RULE 已登记 buyStalePrice（否则面板只会显示"等待新信号"，真实原因被吞掉）');

// ───────── 4. 副本不按本地流水重建持仓（repairPositions 副本闸） ─────────
const iRep = SRC.indexOf("if (c.action === 'repairPositions') {");
ok(iRep > 0, '存在 /api/paper 的 repairPositions 分支');
// 片段取到「本地重建」那一行之后，才能同时验证「有副本闸」与「闸在重建之前」
const _repEnd = SRC.indexOf('paperRepairPositions(key)', iRep);
const repSrc = _repEnd > 0 ? SRC.slice(iRep, _repEnd + 40) : SRC.slice(iRep, iRep + 2000);
ok(/if \(isReplica\(\)\) \{[\s\S]{0,900}?changed: 0[\s\S]{0,400}?syncUpstream\('\/api\/paper', c\);[\s\S]{0,60}?return;/.test(repSrc),
  '副本上 repairPositions 只转发线上、不在本机重建（防把流水里的历史票补回持仓）');
ok(repSrc.indexOf('isReplica()') > 0 && repSrc.indexOf('isReplica()') < repSrc.indexOf('paperRepairPositions(key)'),
  '副本闸在调用"本地重建"之前（顺序错了等于没闸）');

// ───────── 5. 修复记录不许撒谎：先取旧值再赋值 ─────────
const iPR = SRC.indexOf('function paperRepairPositions(');
const prSrc = SRC.slice(iPR, SRC.indexOf('\n}\n', iPR) + 3);
ok(/const oldShares = Number\(existing\.shares\)/.test(prSrc) && /const oldBasis = /.test(prSrc),
  '修正分支先存旧值（oldShares/oldBasis）');
ok(prSrc.indexOf('const oldShares') < prSrc.indexOf('existing.shares = info.shares'),
  '取旧值在赋值之前（否则记录前后同值，等于没记）');
ok(/notes\.push\(`\$\{code\}: 修正 \$\{oldShares\}股\/\$\{oldBasis\}元 -> \$\{info\.shares\}股\/\$\{basis\}元`\)/.test(prSrc),
  '修正记录同时写清旧值与新值，带单位');
ok(!/existing\.lastPrice = buyPrice;/.test(prSrc),
  '对账不再覆盖 lastPrice（行情观测值不属于对账管辖，覆盖会让浮盈瞬间显示成 0）');

// ───────── 6. T+1 标记不许硬写 true ─────────
ok(/t1Locked: paperT1Locked\(\{ buyTs: t\.t \}\)/.test(prSrc),
  '补齐持仓时 T+1 标记按买入流水时间判定，不硬写 true');

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
