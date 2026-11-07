// 守门：数据新鲜度（is 轮续，2026-10-19 事故复盘 —— 用户「数据要及时性准确性，避免此类事件」）
// 2026-10-19 事故：K线三源级联故障 → dataTradeDay 探测错停 10-16 → 涨停池/板块归属日错停一天，
//   而 credibilityDiag ① 只看 ztDayProbed（探测「成功」与否）、不看 ztDay 是否真等于今天，
//   报「✅ 可信」——数据错停一整天，用户打开面板才发现。
// 钉死两件事：
//   A. dataStaleItems() 判据：归属日 < 今天 → 报陈旧；== 今天 / 空 / 非法 / 未来 → 不报。
//      判据只依赖「归属日 vs 今天」，不依赖 dataTradeDay 探测（正是它错的）。
//   B. credibilityDiag ① 升级：探测「成功」≠「正确」，ztDayProbed=true 但 ztDay≠今天 必须报落后。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
};

// 花括号配平抠函数体（不固定行号）
function grab(fnName) {
  const i = SRC.indexOf('function ' + fnName + '(');
  if (i < 0) return null;
  let j = SRC.indexOf('{', i);
  let depth = 0, k = j;
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(j + 1, k);
}

// ─── A. dataStaleItems 真跑 ───
const body = grab('dataStaleItems');
ok('dataStaleItems 函数体抠得出来', !!body);

if (body) {
  const factory = new Function('S', 'todayStr', 'function dataStaleItems() {' + body + '} return dataStaleItems;');
  const run = (today, ztDay, sectorsDay) => factory({ ztDay, sectorsDay }, () => today)();

  let r = run('20261019', '20261016', '20261016');
  ok('ztDay/sectorsDay 都落后今天 → 报 2 项', r.length === 2 && r.some(x => /涨停池/.test(x)) && r.some(x => /板块资金流/.test(x)), JSON.stringify(r));

  r = run('20261019', '20261019', '20261019');
  ok('归属日都 == 今天 → 不报', r.length === 0, JSON.stringify(r));

  r = run('20261019', '', '');
  ok('归属日为空 → 不报（不许拿空冒充陈旧）', r.length === 0, JSON.stringify(r));

  r = run('20261019', '2026-10-16', '20261019');
  ok('带横杠的归属日也能归一化识别（2026-10-16 → 涨停池）', r.length === 1 && /涨停池/.test(r[0]), JSON.stringify(r));

  r = run('20261019', '20261020', '20261019');
  ok('未来日期 → 不报（z < ds 才报）', r.length === 0, JSON.stringify(r));

  r = run('20261019', 'notadate', '20261016');
  ok('非法归属日 → 不报（/^\\d{8}$/ 挡掉），板块正常报', r.length === 1 && /板块资金流/.test(r[0]), JSON.stringify(r));
}

// ─── B. credibilityDiag ① 升级：探测「成功」≠「正确」 ───
{
  const seg = SRC.slice(SRC.indexOf('// ① 盖戳可信度'), SRC.indexOf('// ② 快照归属日'));
  ok('credibilityDiag ① 有「ztDay ≠ 今天」的落后判据（_ztD !== ds）', /_ztD\s*!==\s*ds/.test(seg));
  ok('credibilityDiag ① 落后分支文案点破「探测成功但结果落后」', /探测虽「成功」但结果落后|归属日落後|≠今天/.test(seg));
}

// ─── C. 数据延迟定时器接线：16:30 后每分钟查、复用健康告警 ───
{
  const seg = SRC.slice(SRC.indexOf('数据延迟主动告警'), SRC.indexOf('数据延迟主动告警') + 900);
  ok('数据延迟定时器有 16:30 门槛（收盘后缓冲）', /16\s*\*\s*60\s*\+\s*30/.test(seg));
  ok('数据延迟定时器复用 _healthAlert（归健康告警类，每天一条）', /_healthAlert\('dataStale'/.test(seg));
  ok('数据延迟定时器判据走 dataStaleItems()（不依赖 dataTradeDay）', /dataStaleItems\(\)/.test(seg));
  ok('数据延迟定时器只在交易日检查', /isTradeDay\(d\)/.test(seg));
}

console.log(`===== 数据新鲜度 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail > 0 ? 1 : 0);
