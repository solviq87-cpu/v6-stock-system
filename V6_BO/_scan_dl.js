// dl 轮侦察：同一个「成功」，在系统里有几种说法
// ① return {ok:true} / return true / console.log('…完成') —— 各处"成功"都说了什么、带不带产出条数
// ② ⛔ 「成功但 0 条」与「成功且有产出」是不是同一个说法（面板/日志都写"完成"，用户分不清
//    "今天就没符合条件的票" 和 "数据源挂了所以 0 只"）
// ③ 各池子 n=0 时的出口文案
// ④ 推送侧：pushAll 成功/被闸门拦下/条数用完 —— 是不是都算"成功"
const fs = require('fs');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const SVS = strip(SV).split('\n');

// ── ① 成功出口写法 ──────────────────────────────────────────────────────
console.log('【① 成功出口的写法】');
const PAT = [
  ['return { ok: true }', /return\s*\{\s*ok:\s*true/],
  ['return true',         /return\s+true\s*;/],
  ['console.log 完成/OK',  /console\.log\([^)]*(完成|OK|成功|就绪)/],
  ['pushLog ✅',          /pushLog\(\s*['"`]✅/],
  ['resolve/end 无产出',   /return\s*;\s*$/],
];
for (const [nm, re] of PAT) {
  let n = 0; const ex = [];
  for (let i = 0; i < SVS.length; i++) {
    const l = SVS[i]; if (l.length > 400) continue;
    if (re.test(l)) { n++; if (ex.length < 3) ex.push('L' + (i + 1) + ' ' + l.trim().slice(0, 95)); }
  }
  console.log('  ' + nm.padEnd(22) + String(n).padStart(4) + ' 处');
  for (const e of ex) console.log('        ' + e);
}

// ── ② 「成功」带不带产出条数 ───────────────────────────────────────────
console.log('\n【② return {ok:true} 的地方，有没有带上"本轮产出几条"】');
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i]; if (l.length > 400) continue;
  if (!/return\s*\{\s*ok:\s*true/.test(l)) continue;
  const has = /total:|n:|count:|items:|length/.test(l);
  console.log('  ' + (has ? '带 ' : '⛔无 ') + 'L' + String(i + 1).padStart(5) + '  ' + l.trim().slice(0, 115));
}

// ── ③ 各池子 n=0 时的出口文案 ──────────────────────────────────────────
console.log('\n【③ 池子为空（0 只）时的出口说法】');
const ZERO = [/暂时无|暂无|没有找到|无标的|0 只|0只|空$|为空|items:\s*\[\s*\]/];
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i]; if (l.length > 400) continue;
  if (!/items:\s*\[\s*\]|length\s*===\s*0|!\w+\.length/.test(l)) continue;
  console.log('  L' + String(i + 1).padStart(5) + '  ' + l.trim().slice(0, 120));
}

// ── ④ dk 轮刚加的 taskSet：成功时区分 n>0 与 n=0 吗 ────────────────────
console.log('\n【④ taskSet 成功调用点：有没有区分「有产出」与「跑通但 0 条」】');
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i]; if (l.length > 400) continue;
  if (!/taskSet\(/.test(l)) continue;
  console.log('  L' + String(i + 1).padStart(5) + '  ' + l.trim().slice(0, 120));
}

// ── ⑤ 推送侧：成功/被拦/用完 是不是一个说法 ────────────────────────────
console.log('\n【⑤ pushAll 的返回值语义（false 只留给夜间静默）】');
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i]; if (l.length > 400) continue;
  if (/function pushAll/.test(l)) {
    for (let k = i; k < i + 40 && k < SVS.length; k++) {
      if (/return\s+(true|false)|pushLog\(/.test(SVS[k])) console.log('  L' + (k + 1) + '  ' + SVS[k].trim().slice(0, 115));
    }
    break;
  }
}
