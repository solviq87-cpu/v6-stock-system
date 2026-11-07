// 扫描器：列出所有「当日一次性闭锁」，标出哪些仍是纯内存变量（重启 = 重放）。
// 判据：`xxx !== ds` / `xxx === ds`（ds = todayStr()）这种按天闭锁，如果它的声明是
// `let xxx = '';`，那它只活在内存里 —— 发布/实例回收一重启就清零，当天已推过的消息会再推一遍。
// 修法：改成 `let xxx = sentLockFromPushLog(/标题正则/, '名字')`，启动时用落盘流水恢复。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

// 找出 `xxx !== ds` / `xxx === ds` 里的变量名
const names = new Set();
for (const m of SVK.matchAll(/([A-Za-z_$][\w$]*)\s*!==\s*(?:ds|_ds)\b/g)) names.add(m[1]);
for (const m of SVK.matchAll(/([A-Za-z_$][\w$]*)\s*===\s*(?:ds|_ds)\b/g)) names.add(m[1]);

// 已复核「不是故障」的闭锁：它们不产生外发推送，重启重跑一次没有任何副作用
const BENIGN = {
  _sweepDay: '跨日清扫内存去重表（重跑一次无副作用）',
  d: '误匹配：局部变量 d（日期对象），不是闭锁',
  _holidayWarnDay: '只 console.warn（节假日表过期提醒），不外发',
  learnallDate: '只进面板流水 pushLog，不发手机',
};
const rows = [];
for (const n of names) {
  if (BENIGN[n]) { rows.push({ n, kind: '已复核·无外发 ☑ ' + BENIGN[n], bad: false }); continue; }
  const decl = new RegExp('let\\s+' + n.replace(/\$/g, '\\$') + '\\s*=').exec(SV);
  if (!decl) { rows.push({ n, kind: '(未见声明)', bad: false }); continue; }
  const after = SV.slice(decl.index, decl.index + 120);
  const fromLog = /let\s+[\w$]+\s*=\s*sentLockFromPushLog\(/.test(after);
  rows.push({ n, kind: fromLog ? '流水重建 ✅' : "裸 '' ⚠️", bad: !fromLog, snippet: after.split('\n')[0].slice(0, 90) });
}

console.log('当日一次性闭锁（共 ' + rows.length + ' 处）：\n');
for (const r of rows) {
  console.log((r.bad ? '⚠️ ' : '   ') + r.n.padEnd(20) + r.kind + (r.snippet ? '   ' + r.snippet : ''));
}
const bad = rows.filter(r => r.bad);
console.log('\n仍是纯内存（重启会重放）的闭锁：' + bad.length + ' 处' +
  (bad.length ? ' → ' + bad.map(r => r.n).join('、') : ''));
console.log('说明：只进面板流水（pushLog）或只打 console 的闭锁不算故障，无需重建。');
