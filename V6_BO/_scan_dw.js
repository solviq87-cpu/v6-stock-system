// dw 轮侦察器：系统里那些「补救动作」（重试 / 补发 / 回填 / 自愈 / 兜底重算）
// 重点看三件事：
//  ① 补救有没有第二个人在跑（两个入口各补一遍 or 都以为对方会补）
//  ② 补救失败/被跳过之后还有没有第二次机会，会不会被自己的闭锁永久关掉
//  ③ 补救自己跳过的时候留不留痕（dv 轮刚建的 skipAdd 有没有覆盖到补救路径）
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
const LINES = SRC.split('\n');

// 剥掉纯注释行与超长版本注释行
const code = LINES.map((l, i) => (/^\s*(\/\/|\*|\/\*)/.test(l) || l.length > 800 ? '' : l));

function fnBody(name) {
  const i = SRC.indexOf(name);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return null;
}

// ── 一、补救动作清单：函数名或定时器回调里带补救语义 ──
const REMEDY_RE = /补发|补推|重试|重新算|重算|回填|backfill|补拉|补跑|补扫|自愈|heal|兜底重算|再试一次|兜一次|补一次|补救|re\w*try/i;
const remedyFns = new Set();
for (const m of SRC.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
  const nm = m[1];
  const b = fnBody('function ' + nm + '(');
  if (!b) continue;
  // 函数名本身带补救语义，或函数体里补救语义出现 >=2 次
  const hitName = REMEDY_RE.test(nm);
  const hitBody = (b.match(REMEDY_RE) || []).length >= 2;
  if (hitName || hitBody) remedyFns.add(nm);
}

console.log('=== 一、补救动作函数（' + remedyFns.size + ' 个）===');
const rows = [];
for (const nm of [...remedyFns].sort()) {
  const b = fnBody('function ' + nm + '(') || '';
  const bl = b.split('\n');
  // 静默 return：return; / return false; / return 无日志无计数
  const bareRet = bl.filter(l => /^\s*return\s*;?\s*$/.test(l) || /^\s*return\s+(false|true|null)\s*;\s*$/.test(l));
  const retWithLog = bl.filter(l => /return/.test(l) && /(console\.|log\(|pushLog|WARN|warn|告警|留痕)/.test(l));
  const hasSkipAdd = b.includes('skipAdd(');
  const callers = (SRC.match(new RegExp('\\b' + nm.replace(/\$/g, '\\$') + '\\s*\\(', 'g')) || []).length - 1;
  rows.push({ nm, ret: bareRet.length, retLog: retWithLog.length, skipAdd: hasSkipAdd, callers, lines: bl.length });
}
rows.sort((a, b) => (b.ret - b.skipAdd * 100) - (a.ret - a.skipAdd * 100));
for (const r of rows.slice(0, 40)) {
  console.log(`  ${r.nm.padEnd(28)} 静默return=${String(r.ret).padStart(2)} 带日志return=${String(r.retLog).padStart(2)} skipAdd=${r.skipAdd ? 'Y' : '·'} 调用点=${String(r.callers).padStart(2)} 行数=${r.lines}`);
}

// ── 二、启动链补救：init() 里的 setTimeout（一次性补救）──
console.log('\n=== 二、启动链上的 setTimeout（一次性补救，机会有限）===');
const setT = [];
code.forEach((l, i) => {
  if (!/setTimeout\(/.test(l)) return;
  const ms = (l.match(/setTimeout\([^,]+,\s*([\d\s*+x]+)\)/) || [])[1];
  setT.push({ line: i + 1, ms: (ms || '').replace(/\s/g, ''), txt: l.trim().slice(0, 110) });
});
console.log('  共 ' + setT.length + ' 处');
for (const s of setT) console.log(`  L${String(s.line).padStart(5)} ${s.ms.padEnd(14)} ${s.txt}`);

// ── 三、补救动作的「机会」：一次性标记 / 闭锁 ──
console.log('\n=== 三、一次性标记（补救被它永久关掉的风险）===');
const once = [];
for (const m of SRC.matchAll(/(?:let|var|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(null|false|0|'')\s*;/g)) {
  const nm = m[1];
  if (!/(Sent|Done|Checked|Tried|Retried|Fixed|Healed|Backfilled|Filled|SentDate|Startup|_once|Once|Boot)/i.test(nm)) continue;
  const assigns = (SRC.match(new RegExp('\\b' + nm + '\\s*=[^=]', 'g')) || []).length;
  once.push({ nm, assigns });
}
for (const o of once.sort((a, b) => a.assigns - b.assigns)) console.log(`  ${o.nm.padEnd(26)} 赋值处=${o.assigns}`);

// ── 四、补救路径上的静默 return（dv 轮 skipAdd 覆盖率）──
console.log('\n=== 四、补救函数里的静默 return 明细（前 60 行）===');
let n = 0;
for (const r of rows) {
  if (r.ret === 0) continue;
  const b = fnBody('function ' + r.nm + '(') || '';
  const bl = b.split('\n');
  bl.forEach((l, k) => {
    if (n >= 60) return;
    if (!/^\s*return\s*;?\s*$/.test(l) && !/^\s*return\s+(false|true|null)\s*;\s*$/.test(l)) return;
    n++;
    console.log(`  ${r.nm} :: ${l.trim().slice(0, 90)}`);
  });
  if (n >= 60) break;
}
