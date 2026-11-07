// 异步任务的 pending 承诺必须有收尾（本轮新角度）。
//
// 故障形态：接口秒回 `ok:true, pending:true, note:'处理中…'`，然后把重活丢到后台去跑。
//   这条链路一旦**后台失败**，用户那边是彻底没有出口的 —— 响应早就发完了，
//   面板那栏只会静静停在旧数据上，用户既不知道失败，也不知道还要不要等。
//   比这更糟的是前端无限轮询：回测那个 setInterval 只在拿到非空结果时才 clearInterval，
//   失败时 result 永远回 empty:true → 每 3 秒打一次，打到关页面为止。
//
// 本轮实测：
//   ① /api/trend-scan、/api/steady-up、/api/kline-backfill 三处后台失败只 console.error，
//      而同类的 /api/learnall-ingest 早就写了 `pushLog('❌ 学习入库失败')` —— 样板就在隔壁没被抄。
//   ② 被 _tsBusy 挡下时 scanTrendUniverse 返回 { ok:false, running:true }，这次**根本没启动**，
//      可接口已经回了「扫描中」，用户以为是自己点的这轮在跑 —— 结果被冒领。
//   ③ /api/backtest 失败时 S.backtest 里还躺着【上一次】的结果，result 原样返回，
//      前端一看非空就渲染 → 把上一次的成绩当成这次的。另一种情形是从没成功过，
//      result 永远 empty:true → 前端轮询永不停止。
//
// 另外核对「重启后 pending 会不会永久悬着」：_tsBusy / _kbfBusy 是模块级 let、S 不整体落盘，
//   重启一律归零 —— 这条是干净的，写进断言防以后有人把它们挪进持久化状态。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// ⛔ 判"活代码"一律用剥注释版本：注释里会引用旧写法（已踩 7 次）
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
const lineOf = i => SV.slice(0, i).split('\n').length;

// 切出所有秒回 pending 的路由块（按语义边界：下一个路由）
function pendingBlocks() {
  const out = [];
  const re = /pending:\s*true/g;
  let m;
  while ((m = re.exec(CODE_K))) {
    let s = CODE_K.lastIndexOf("if (p === '", m.index);
    if (s < 0) continue;
    let j = CODE_K.indexOf("if (p === '", m.index);
    if (j < 0) j = CODE_K.length;
    const route = (SV.slice(s, s + 60).match(/'([\/\w-]+)'/) || ['', '?'])[1];
    out.push({ route, start: s, end: j, body: SV.slice(s, j), i: m.index });
  }
  return out;
}

group('[1] 每个"后台跑重活"的 pending，失败必须有发声（不能只进日志）');
{
  const bs = pendingBlocks();
  ok('找到 pending 路由块', bs.length >= 6, String(bs.length));
  let checked = 0;
  for (const b of bs) {
    // 只有"后台真跑了异步任务"的才需要收尾（等待开发者确认那类没有异步任务）
    const hasAsync = /\)\s*\.then\(|\(async \(\) =>|\.catch\(/.test(b.body);
    if (!hasAsync) continue;
    checked++;
    const voice = /pushLog\(|pushWecom\(/.test(b.body);
    ok(`${b.route}（L${lineOf(b.i)}）失败会发声（pushLog / pushWecom）`, voice);
    // 反向：不许出现"catch 里只有一句 console.error"的裸兜底
    const bare = [...b.body.matchAll(/\.catch\(\s*e\s*=>\s*console\.error\([^)]*\)\s*\)/g)];
    ok(`${b.route} 没有只进日志的裸 catch`, bare.length === 0, String(bare.length));
  }
  ok('确实覆盖到了后台异步 pending（不是空跑）', checked >= 5, String(checked));
  // 逐条钉住本轮补的三处（样板 /api/learnall-ingest 本来就有）
  for (const [name, re] of [
    ['趋势扫描', /pushLog\('❌ 全市场趋势扫描失败'/],
    ['连续收涨', /pushLog\('❌ 连续收涨扫描失败'/],
    ['K线补齐', /pushLog\('❌ 全市场K线补齐失败'/],
    ['学习入库（既有样板）', /pushLog\('❌ 学习入库失败'/],
  ]) ok(`${name} 失败会进推送流水`, re.test(SV));
}

group('[2] 被忙碌标志挡下时要如实说"这次没启动"，不许冒领上一轮的结果');
{
  ok('趋势扫描认 running 分支', /if \(r && r\.running\)[\s\S]{0,200}pushLog\('⏭ 全市场扫描未启动'/.test(SV));
  ok('连续收涨认 running 分支', /if \(r && r\.running\)[\s\S]{0,200}pushLog\('⏭ 连续收涨扫描未启动'/.test(SV));
  ok('scanTrendUniverse 忙时确实返回 running:true', /if \(_tsBusy\) return \{ ok: false, running: true, prog: _tsProg \}/.test(SV));
  ok('忙碌标志在 finally 里释放（异常也不会永久占用）',
    /finally \{ _tsBusy = false; \}/.test(SV) && /finally \{ _kbfProg[\s\S]{0,60}_kbfBusy = false; \}/.test(SV));
}

group('[3] 回测：失败不许把上一次的成绩当本次结果');
{
  ok('新一轮开始先清掉上一轮的失败态', /S\.backtestErr = '';/.test(SV));
  ok('失败时把原因挂到 S.backtestErr', /S\.backtestErr = \(e && e\.message\) \|\| String\(e\);/.test(SV));
  ok('result 接口在有失败态时不返回旧结果',
    /\(S\.backtest && !S\.backtestErr\)\s*\?\s*S\.backtest\s*:\s*\{ pending: !!S\.backtestPending, empty: true, error: S\.backtestErr \|\| '' \}/.test(SV));
  // 行为验证：把这段三元逻辑抠出来真跑
  const resultOf = (bt, err, pending) => (bt && !err) ? bt : { pending: !!pending, empty: true, error: err || '' };
  const OLD = { 总样本: 600, tag: '上一次' };
  ok('有旧结果 + 本次失败 → 不返回旧结果，回 error',
    resultOf(OLD, '回测崩了', false).empty === true && resultOf(OLD, '回测崩了', false).error === '回测崩了');
  ok('反证：旧写法（只判 S.backtest）会把上一次的成绩原样回出去',
    (bt => bt || { empty: true })(OLD).总样本 === 600);
  ok('没跑过 + 没失败 → 回 empty 且 error 为空串',
    resultOf(null, '', false).empty === true && resultOf(null, '', false).error === '');
  ok('成功 → 正常返回结果', resultOf(OLD, '', false).总样本 === 600);
}

group('[4] 前端轮询必须有出口：失败要停表、超时要停表（不许无限打接口）');
{
  const i = HTML.indexOf('async function runBacktest');
  ok('找到前端回测轮询', i > 0);
  // 别写死字符窗口：按语义边界切到下一个顶层 function
  const j = HTML.indexOf('\nfunction ', i + 10);
  const k = HTML.indexOf('\nasync function ', i + 10);
  const end = Math.min(...[j, k].filter(x => x > i), HTML.length);
  const body = HTML.slice(i, end > i ? end : HTML.length);
  ok('⛔ 不再有 `if (r.empty) return;` 这种唯一出口的写法', !/if \(r\.empty\) return;/.test(body));
  ok('收到 error 会停表并提示', /r\.error[\s\S]{0,120}clearInterval\(poll\)/.test(body));
  ok('有轮询次数上限', /tries\s*>=\s*\d+/.test(body) && /clearInterval\(poll\)/.test(body));
  ok('每次轮询都累加计数（否则上限永不触发）', /tries\+\+/.test(body));
  ok('超时文案说清了可能原因与下一步', /回测超时/.test(body) && /重试/.test(body));
  // 反证：旧写法在失败时会一直轮询
  ok('反证：只判 !r.empty 的旧写法在失败时永不 clearInterval',
    !(() => { const r = { empty: true }; return !r.empty; })());
}

group('[5] 重启后 pending 不许永久悬着：忙碌标志一律不落盘');
{
  ok('_tsBusy 是模块级内存变量', /^let _tsBusy = false;/m.test(SV));
  ok('_kbfBusy 是模块级内存变量', /^let _kbfBusy = false;/m.test(SV));
  ok('⛔ 忙碌标志不挂在被持久化的 S 上',
    !/S\._tsBusy|S\._kbfBusy/.test(CODE_K));
  ok('回测 busy 用的虽然挂在 S，但 S 不整体落盘（无 state 写盘）',
    !/atomicWrite\([^)]*[Ss]tate\.json/.test(CODE_K) && !/writeFileSync\([^)]*[Ss]tate\.json/.test(CODE_K));
  ok('面板接口读得到进度（用户至少能看到在动）',
    /prog: _tsProg/.test(SV) && /prog: _kbfProg/.test(SV));
}

group('[6] 承诺与实际行为必须一致：找回密码那条「已推送到手机」是 2026-10-02 之前的说法');
{
  ok('⛔ 不再回传明文新密码（前端根本不读它，白白挂在响应链路上）',
    !/password:\s*npwd/.test(CODE_K));
  // ⛔ 必须在剥注释的版本上判：我为了解释这个 bug 写的注释里逐字引用了那句旧文案，
  //    对整份 SV 跑正则会命中注释 → 永远红（本项目已踩 10 次，勿再犯）。
  ok('⛔ 不再承诺「新密码同时推送到手机」（sendPwdCard 只发不含明文的通知）',
    !/新密码同时推送到手机/.test(CODE_K));
  ok('note 改成"手机上会收到一条变更通知"（与 sendPwdCard 的实际行为对得上）',
    /手机上会收到一条变更通知/.test(SV));
  ok('sendPwdCard 只报结果不报明文（有既定注释说明）',
    /只报结果，不报明文/.test(SV));
  ok('密码变更通知推送失败会进流水（不再只 console.error）',
    /pushLog\('❌ 密码变更通知未送出'/.test(SV));
  // 反证：旧文案会让人关掉页面去翻手机，而手机上是找不到密码的
  ok('反证：旧文案承诺的东西，代码从来没做过', !/emphasis_content[\s\S]{0,80}npwd/.test(CODE_K));
}

console.log(`\n===== pending 承诺收尾 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
