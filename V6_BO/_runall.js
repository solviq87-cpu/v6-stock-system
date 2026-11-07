// 全量守门测试总榜
//
// ⛔⛔ 2026-10-07 重写判定口径（本轮「不看代码看事实」查出来的最严重的一处）：
//    旧口径是「先找 `N 通过 / M 失败` 汇总行，找不到就数 ✓ / ✗ 的行数」，
//    而只要打出过几个 ✓、就**永远不会标红**。实测两个套件是真崩了（exit 1）：
//      · _test_src_priv_channel.js —— 7 个 ✓ 之后 ReferenceError（沙箱缺 pushedToday）
//      · _test_enum_gap.js        —— 14 个 ✓ 之后 ReferenceError（沙箱缺 savePushGov，bt 轮引入）
//    它们从崩的那天起，在总榜上一直是绿的，只是断言数少了一截 ——
//    这就是"总断言数为何加了新测试反而下降"的答案：**不是少做了，是有一整段从来没跑过**。
//    另有 11 个套件用的是 ✅ 与「合计 27 项：通过 27、失败 0」这类中文汇总，
//    旧正则一个都不认 → 按 0 断言计，同样不红。
//
//    现在三条硬口径：
//      ① **退出码非 0 一律标红**，不管打过多少 ✓（崩了就是崩了，没有"部分通过"）
//      ② 汇总行认四种写法：`N 通过 / M 失败`、`通过 N、失败 M`、`通过 N 失败 M`、`<数字> 项：…`
//      ③ 既没有汇总行、也没有任何 ✓ / ✅ / 对勾 标记的，标「无输出」并计红（套件压根没跑起来）
//    另外把「断言数是从标记数出来的」这类套件单独列出来，提醒它们补一行标准汇总。
const fs = require('fs');
const { execFile } = require('child_process');
const files = fs.readdirSync('.').filter(f => /^_test_.*\.js$/.test(f)).sort();
// 判定口径（抽成函数，供 _test_runall_honesty.js 拿真实行为做断言）
// ⛔ 关键：err（非 0 退出码 / 被信号杀掉）必须压过一切标记 —— 崩掉的套件可能已经打出过几个 ✅，
//    旧口径只数标记，于是"跑到一半崩了"在总榜上显示为绿灯，只有断言总数悄悄少一截。
function judge(out, err) {
  out = String(out || '');
  let pass = -1, fail = -1, how = '';
  let all = [...out.matchAll(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/g)];
  if (all.length) { const m = all[all.length - 1]; pass = +m[1]; fail = +m[2]; how = '汇总'; }
  if (pass < 0) {
    all = [...out.matchAll(/通过\s*(\d+)\s*(?:项)?\s*[、,，]\s*失败\s*(\d+)/g)];
    if (all.length) { const m = all[all.length - 1]; pass = +m[1]; fail = +m[2]; how = '中文汇总'; }
  }
  // ③「通过 20 / 20」这种只给总数的写法：分母是总数，失败 = 总数 - 通过
  if (pass < 0) {
    const m = out.match(/通过\s*(\d+)\s*\/\s*(\d+)(?!\s*失败)/);
    if (m) { pass = +m[1]; fail = Math.max(0, +m[2] - +m[1]); how = '分数汇总'; }
  }
  if (pass < 0) {
    const oks = (out.match(/^\s*(?:✓|✅|对勾)/gm) || []).length;
    const ngs = (out.match(/^\s*(?:✗|❌)/gm) || []).length;
    pass = oks; fail = ngs; how = '数标记';
  }
  const crashed = !!err;
  if (crashed && fail === 0) fail = 1;
  if (!crashed && pass === 0 && fail === 0) fail = 1;
  return { pass, fail, how, crashed };
}
module.exports = { judge };

const results = [];
let i = 0;
function next() {
  if (i >= files.length) return report();
  const f = files[i++];
  const t0 = Date.now();
  // ⛔ 2026-10-06 修：90s 太紧，_test_hold2.js 这类「真实服务 + 多次写持仓」的套件会被拦腰截断
  //    → 它单独跑 51s 全绿，批量里撞上限就变 SIGTERM，总榜每次都是一条假红。
  //    持仓写入后会触发真实重算（拉行情+逐票K线），慢的时候一轮就好几秒，放宽到 180s。
  // ⛔ 2026-10-28 再放宽（按套件给上限）：_test_learnall_valid.js 要做「30 个交易日 × 每天 5 只」
  //    的留出验证 + 500 轮蒙特卡洛对照组，实测单独跑 173s —— 正好卡在 180s 线上，
  //    批量跑时机器一忙就 SIGTERM，总榜又一条假红（真结论是 24/0 全绿）。
  //    算力型套件的时间上限本来就该按最坏情况单独给，不该和 IO 型套件共用一个数。
  // ⛔ 2026-10-29 加 routes_smoke：它要真发 55 条 GET 请求（含几条要现场扫全A/K线），
  //    空跑实测 78s，批量跑时机器一忙就撞 180s 被 SIGTERM —— 又一条「代码没问题、超时背锅」的假红
  //    （2026-10-28 22:06 那次就是这样被记成红，实际单跑全绿）。
  //    与 learnall_valid（算力型 167s）同一处置：按套件给上限。
  const HEAVY = /_test_(learnall_valid|routes_smoke)\.js$/.test(f);
  const TIMEOUT_MS = HEAVY ? 420000 : 180000;
  execFile(process.execPath, [f], { timeout: TIMEOUT_MS, maxBuffer: 4 << 20 }, (err, so, se) => {
    const r = judge(String(so || '') + String(se || ''), err);
    results.push({ f, pass: r.pass, fail: r.fail, how: r.how, ms: Date.now() - t0, err: err ? (err.signal || err.code || '') : '' });
    next();
  });
}
function report() {
  const red = results.filter(r => r.fail > 0);
  console.log('=== 全量守门测试（' + results.length + ' 个套件）===');
  const sumP = results.reduce((a, b) => a + Math.max(0, b.pass), 0);
  const sumF = results.reduce((a, b) => a + Math.max(0, b.fail), 0);
  console.log('通过断言 ' + sumP + ' / 失败断言 ' + sumF + '\n');
  if (red.length) {
    console.log('--- 红灯套件 ---');
    red.forEach(r => console.log('  ✗ ' + r.f + ' (' + r.ms + 'ms) ' + (r.err ? '退出码/信号: ' + r.err : '断言失败 ' + r.fail)));
  } else {
    console.log('全绿，无红灯套件');
  }
  // 提醒：靠"数标记"得到断言数的套件，补一行标准汇总会更好查
  const byMark = results.filter(r => r.how === '数标记');
  if (byMark.length) {
    console.log('\n以下 ' + byMark.length + ' 个套件没有标准汇总行（按标记计数）：' + byMark.map(r => r.f.replace('_test_', '')).join('、'));
  }
  const slow = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log('\n最慢 5 个：' + slow.map(s => s.f.replace('_test_', '') + ' ' + s.ms + 'ms').join(' | '));
  process.exitCode = red.length ? 1 : 0;
}
if (require.main === module) next();
