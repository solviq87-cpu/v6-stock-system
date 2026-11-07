// 守门测试：一份数据被截断 / 归并之后，依赖它的结论还成不成立（du 轮）
//
// 实证（本机真实数据）：模拟盘流水上限 300 条，`acc.trades` 满 300 后 `pop()` 丢掉最老的。
// 而对账 `paperAudit` 是**拿全流水从头重算现金**的 —— 实测 pre 账户丢掉最老 20 笔后，
// dCash 从 0 直接变成 **375,521.12 元**，被判「账目对不上」，文案还建议「可用重置清空重来」。
// 真相只是**证据被丢了**，账一点没错；照着建议做会把剩下的几百笔也删掉（不可逆）。
// 同理：pushlog.json 实测已顶到 500/500 条，而「今天已发」闭锁（bt 轮 11 个）全靠它 ——
// 单日推送一旦超过上限，当天更早的记录被挤掉 → 判据静默失效 → 重复推送。
// ⛔ 本轮钉的是：结论必须知道自己读的数据**全不全**；不全就说「证据不全」，不许说「账错了」。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

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
let strip = null;
try { strip = require('./_codescan.js').stripNoise; } catch { }
const SV = strip ? strip(src, { keepStrings: true }) : src;
const capSrc = (src.match(/const DATA_CAP = \{[\s\S]*?\n\};/) || [''])[0];

const tolM = src.match(/const PAPER_AUDIT_TOL = ([\d.]+);/);
const TOL = tolM ? +tolM[1] : 0.05;
const mkPaper = (PAPER, PAPER_CFG) => new Function('PAPER', 'PAPER_CFG', [
  capSrc,
  grab(/function dataCapOf\(k\) \{/),
  grab(/function paperTradeKey\(t\) \{/),
  grab(/function repairTradeSide\(side\) \{/), // ⛔ dy 轮补：paperMergeTrades 入口先修 side 乱码再判重，漏注入=整段崩
  grab(/function paperMergeTrades\(local, incoming\) \{/),
  grab(/function paperTradeFlow\(t\) \{/),
  grab(/function paperTol\(n\) \{/),
  grab(/function signTxt\(v\) \{/),
  grab(/function paperBasisGap\(tl\) \{/),
  grab(/function paperAudit\(key\) \{/),
  'const PAPER_AUDIT_TOL = ' + TOL + ';',
  'return { dataCapOf, paperTradeKey, paperMergeTrades, paperAudit };'
].join('\n'))(PAPER, PAPER_CFG);

const mkPush = (PUSH_LOG) => new Function('PUSH_LOG', [
  capSrc,
  grab(/function dataCapOf\(k\) \{/),
  grab(/const todayStr = \(\) => \{/),
  // hr 轮 dayKeyOf 由 const 箭头函数改为 function 声明（TDZ 修复）——锚点两种写法都认
  grab(/(?:const dayKeyOf = ts =>|function dayKeyOf\(ts\)) \{/),
  grab(/function pushLogCoversToday\(\) \{/),
  'return { pushLogCoversToday, dataCapOf };'
].join('\n'))(PUSH_LOG);

console.log('\n=== 截断与归并（du 轮）守门 ===\n');

// ---------- ① 容量登记表 ----------
console.log('【① 容量不许散落各处写死】');
ok('存在 DATA_CAP 登记表', /const DATA_CAP = \{/.test(SV));
ok('唯一读口 dataCapOf', /function dataCapOf\(k\) \{/.test(SV));
ok('模拟盘流水上限走登记（无写死 300）', !/acc\.trades\.length > 300/.test(SV));
ok('推送流水上限走登记（无写死 500）', !/PUSH_LOG\.length > 500/.test(SV));
ok('信号上限走登记（无写死 200）', !/S\.signals\.length > 200/.test(SV));
ok('学习流水上限走登记（无写死 300）', !/S\.learnHistory\.length > 300/.test(SV));
{
  const S1 = mkPaper({}, {});
  ok('dataCapOf 读得到各容器容量', S1.dataCapOf('paperTrades') === 300 && S1.dataCapOf('pushLog') === 1500,
    S1.dataCapOf('paperTrades') + '/' + S1.dataCapOf('pushLog'));
  ok('未登记的键返回 0（不当成无限）', S1.dataCapOf('nope') === 0);
}

// ---------- ② 归并键：不许误并 ----------
console.log('\n【② paperTradeKey：不许把两笔并成一笔】');
{
  const S1 = mkPaper({}, {});
  const a = { t: 1, code: 'A', side: '买入', shares: 100, amount: 1000 };
  const b = { t: 1, code: 'A', side: '买入', shares: 200, amount: 2000 };
  ok('同一毫秒同一只票同方向、金额不同 → 键不同', S1.paperTradeKey(a) !== S1.paperTradeKey(b),
    S1.paperTradeKey(a) + ' vs ' + S1.paperTradeKey(b));
  ok('完全相同的两笔 → 键相同（真重复能去重）', S1.paperTradeKey(a) === S1.paperTradeKey({ ...a }));
  // 反证：老的三键写法会把上面两笔判成同一笔
  const oldKey = t => String(t.t) + '|' + t.code + '|' + t.side;
  ok('反证：老的 t|code|side 写法确实会把它们判重（所以必须换）', oldKey(a) === oldKey(b));
}

// ---------- ③ 归并出口：added / dropped / dupDiff 都要交出来 ----------
console.log('\n【③ paperMergeTrades】');
{
  const S1 = mkPaper({}, {});
  const local = [{ t: 30, code: 'A', side: '买入', shares: 100, amount: 1000 }];
  const inc = [{ t: 20, code: 'B', side: '买入', shares: 100, amount: 2000 }];
  const r1 = S1.paperMergeTrades(local, inc);
  ok('C1 新记录并入（added=1）', r1.added === 1 && r1.list.length === 2, JSON.stringify({ a: r1.added, n: r1.list.length }));
  ok('C2 并入后按时间倒序（新的在前）', r1.list[0].t === 30, String(r1.list[0].t));

  const r2 = S1.paperMergeTrades(local, [{ t: 30, code: 'A', side: '买入', shares: 100, amount: 1000 }]);
  ok('C3 一模一样的笔不重复并入', r2.added === 0 && r2.list.length === 1, JSON.stringify({ a: r2.added, n: r2.list.length }));

  // ⛔ 关键反证：三键相同但金额不同 —— 老写法会静默丢掉第二笔
  const r3 = S1.paperMergeTrades(local, [{ t: 30, code: 'A', side: '买入', shares: 200, amount: 2000 }]);
  ok('C4 同时间同票同方向但金额不同 → 不并入并留痕（dupDiff=1）', r3.dupDiff === 1 && r3.added === 0, JSON.stringify(r3));
  ok('C5 ⛔ 反证：它没有被静默当成同一笔丢掉', r3.dupDiff > 0);

  // 容量：造 305 笔 → 必须报告裁掉 5 笔
  const big = [];
  for (let i = 0; i < 305; i++) big.push({ t: 10000 - i, code: 'C' + i, side: '买入', shares: 100, amount: 1000 });
  const r4 = S1.paperMergeTrades([], big);
  ok('C6 超出容量 → 结果不超过 300 笔', r4.list.length === 300, String(r4.list.length));
  ok('C7 ⛔ 裁掉几笔必须报出来（dropped=5）', r4.dropped === 5, String(r4.dropped));
  ok('C8 裁的是最老的（留下的最新 t 最大）', r4.list[0].t === 10000 && r4.list[299].t === 9701,
    r4.list[0].t + '~' + r4.list[299].t);
}

// ---------- ④ 对账：证据不全 ≠ 账记错了 ----------
console.log('\n【④ paperAudit：被裁过就说「证据不全」】');
{
  // 造一个"账完全对得上"的账户（22 笔以内），再人为标记裁过
  const mk = (dropped) => ({
    cash: 100000 - 10005 + 10980, realized: 975, enabled: true, positions: {},
    tradesDropped: dropped,
    trades: [
      { t: 1, code: 'A', side: '买入', amount: 10000, fee: 5, basis: 10005 },
      { t: 2, code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10005, pnl: 975 }
    ]
  });
  const r0 = mkPaper({ pool: mk(0) }, { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D1 未裁过且账对得上 → ok=true', r0.ok === true, JSON.stringify({ ok: r0.ok, dc: r0.dCash }));
  ok('D2 未裁过 → truncated=false / incomplete=false', r0.truncated === false && r0.incomplete === false);

  const r1 = mkPaper({ pool: mk(3) }, { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D3 裁过（tradesDropped=3）→ truncated=true', r1.truncated === true, 'truncated=' + r1.truncated);
  ok('D4 结果带 cap / tradesDropped', r1.cap === 300 && r1.tradesDropped === 3, r1.cap + '/' + r1.tradesDropped);
  ok('D5 账其实对得上 → ok 仍为 true，不该误报 incomplete', r1.ok === true && r1.incomplete === false,
    JSON.stringify({ ok: r1.ok, inc: r1.incomplete }));

  // 有差额 + 裁过 → incomplete
  const acc = mk(10); acc.cash -= 5000;   // 制造真差额（模拟丢了历史流水）
  const r2 = mkPaper({ pool: acc }, { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D6 裁过且有差额 → incomplete=true', r2.incomplete === true, JSON.stringify({ inc: r2.incomplete, dc: r2.dCash }));
  ok('D7 ⛔ 文案说「证据不全」，不说「账记错了」', /证据不全/.test(r2.why), r2.why);
  ok('D8 ⛔ 文案明确劝阻重置', /请勿重置|不要重置|勿重置/.test(r2.why), r2.why);
  ok('D9 ⛔ 文案不再出现「清空重来」', !/清空重来/.test(r2.why), r2.why);
  console.log('     why = ' + r2.why);

  // 反证：没裁过却有差额 → 不许用「证据不全」糊过去
  const acc2 = mk(0); acc2.cash -= 5000;
  const r3 = mkPaper({ pool: acc2 }, { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D10 反证：没裁过却有差额 → incomplete=false（是真差额）', r3.incomplete === false, 'inc=' + r3.incomplete);
  ok('D11 反证：此时文案回到可执行建议', /常见原因/.test(r3.why), r3.why);
}

// ---------- ⑤ 推送流水：判据要知道自己看不看得全 ----------
console.log('\n【⑤ pushLogCoversToday：「今天已发」的证据够不够】');
{
  const DAY = 86400000, now = Date.now();
  const S1 = mkPush([]);
  ok('E1 流水没装满 → 覆盖今天（证据够）', S1.pushLogCoversToday() === true);
  const cap = S1.dataCapOf('pushLog');
  const half = [];
  for (let i = 0; i < cap - 1; i++) half.push({ ts: now - i * 60000 });
  ok('E2 差一条才满 → 仍算覆盖', mkPush(half).pushLogCoversToday() === true);
  // 装满、最老的是 8 天前 → 今天的记录还全在
  const fullOld = [];
  for (let i = 0; i < cap; i++) fullOld.push({ ts: now - i * (DAY / cap) - 8 * DAY });
  ok('E3 装满但最老的是 8 天前 → 覆盖今天', mkPush(fullOld).pushLogCoversToday() === true);
  // ⛔ 装满、最老一条就是今天 → 今天更早的记录已经被裁掉了
  // ⛔ 用「今天零点 + i 秒」而不是「now 往前推」：now 往前推 499 分钟在北京时间
  //    00:00-08:19 之间会跨到昨天 —— 最老一条就不是今天了，判据反而返回 true，
  //    这条反证会在每天凌晨静默失效（2026-10-08 00:29 首跑即红）。
  const _d0 = new Date(); _d0.setHours(0, 0, 0, 0);
  const fullToday = [];
  for (let i = 0; i < cap; i++) fullToday.push({ ts: _d0.getTime() + i * 1000 });   // 全在今天
  ok('E4 ⛔ 装满且最老一条就是今天 → 判据失效（返回 false）', mkPush(fullToday).pushLogCoversToday() === false);
  ok('E5 反证：同样装满但最老的不是今天 → 判据仍可信', mkPush(fullOld).pushLogCoversToday() === true);
}

// ---------- ⑥ 接线：面板要看得见 ----------
console.log('\n【⑥ 接线：证据不全与笔数都要出得去】');
ok('paperSnap 带 tradesTotal / tradesShown', /tradesTotal: \(acc\.trades \|\| \[\]\)\.length/.test(SV));
ok('前端 incomplete 单独成徽标', /p\.audit\.incomplete/.test(html) && /证据不全/.test(html));
ok('前端徽标写明「勿重置」', /勿重置/.test(html));
ok('前端流水列表说明共几笔', /共 \$\{trTotal\} 笔，此处显示最近/.test(html));
ok('回拉走唯一归并出口', /paperMergeTrades\(acc\.trades \|\| \[\], s\.trades\)/.test(SV));
ok('回拉裁笔会留同步留痕', /裁掉最老的/.test(src));
ok('裁笔计数落进 tradesDropped', /acc\.tradesDropped = \(Number\(acc\.tradesDropped\) \|\| 0\) \+ 1/.test(SV));
ok('pushedToday 会检查证据是否覆盖今天', /pushLogCoversToday\(\)/.test(SV));

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_data_cap: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
