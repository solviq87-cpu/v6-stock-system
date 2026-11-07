// 体检扫描器：改了内存但没落盘（2026-10-06）
//
// 这类故障**不报错、不崩**，只是"重启之后某个闸门/某个计数悄悄回到初始值"。
// 分两类看：
//   A. 纯缓存 / 每轮重算的结果 —— 不落盘是**对的**，不用管（数量最多）
//   B. 【当日闭锁 / 去重 / 节流 / 配额】性质的状态 —— 不落盘就是 bug：
//      重启（含平台回收后的冷启动）会把"今天已经做过了"这件事忘掉，于是重做一遍。
//      典型后果：同一条推送当天再发一次、每日配额从头再来、冷却期失效。
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const CODE = stripNoise(fs.readFileSync('server.js', 'utf8'), { keepStrings: true });
const out = [];
const say = s => { out.push(s); console.log(s); };

// 已知会落盘的字段（文件见各 atomicWrite / saveXxx 调用点）
const PERSISTED = new Set(['learn', 'learnHistory', 'marketBeta', 'breadth', 'config', 'news', 'review', 'sectors']);
// B 类嫌疑：名字里带这些词，通常是"已推过 / 已发过 / 计数 / 节流 / 上次"
const LATCH = /(Pushed|Sent|LastPush|Repeat|lastTs|lastRepeat|Seen|DayTake|Quota|Mute|_modDay|PUSH_GOV|reviewSent|goodPushed|holidaySent)/;

say('=== A. 写到 S 上但不落盘的字段（按写入次数降序）===');
const writes = new Map();
for (const m of CODE.matchAll(/\bS\.([A-Za-z_$][\w$]*)\s*(?:\.[A-Za-z_$][\w$]*)?\s*(\.push\(|\.set\(|\.delete\(|\.add\(|=[^=])/g)) {
  const f = m[1];
  if (PERSISTED.has(f)) continue;
  if (!writes.has(f)) writes.set(f, { n: 0, ops: new Set() });
  const v = writes.get(f);
  v.n++;
  v.ops.add(m[2][0] === '=' ? '赋值' : m[2].slice(0, -1));
}
[...writes.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([f, v]) => {
  const flag = LATCH.test(f) ? '  ⚠️ B类嫌疑（当日闭锁/节流）' : '';
  say(`  S.${f.padEnd(22)} 写 ${String(v.n).padStart(3)} 次  ${[...v.ops].join(',')}${flag}`);
});

say('\n=== B. 非 S 的模块级「当日状态」容器（同样看有没有落盘）===');
const MODULE_LATCH = /^(PUSH_GOV|_modDay|_seen|_otp|_otpHit|_authFail|_syncMute|_devTouch|_taskBusy|_secQuota|_rb)$/;
for (const m of CODE.matchAll(/^\s*(?:const|let|var)\s+(_?\w+)\s*=\s*\{[^;]*\};/gm)) {
  const name = m[1];
  if (!MODULE_LATCH.test(name)) continue;
  // ⛔ 窗口别给太小：savePushGov 里 _modDay 出现在函数末尾（前面还有 PUSH_GOV 那一大段），
  //    400 字符扫不到 → 把"已落盘"误报成"没落盘"，扫描器撒谎比不扫更糟。
  const saved = new RegExp('\\b' + name + '[\\s\\S]{0,600}?atomicWrite').test(CODE)
    || new RegExp('function save\\w*\\([\\s\\S]{0,1500}?\\b' + name + '\\b').test(CODE);
  say(`  ${name.padEnd(12)}  ${saved ? '有落盘 ✅' : '⚠️ 无落盘（若含当日闭锁/配额语义就是 bug）'}`);
}

say('\n=== C. 落盘函数与其覆盖的字段 ===');
for (const m of CODE.matchAll(/atomicWrite\([^,]+,\s*([^)]{0,70})/g)) {
  say('  ' + m[1].replace(/\s+/g, ' ').slice(0, 70));
}

say('\n（判读提示：A 里绝大多数是缓存，正常；只有标了 ⚠️ 的 B 类才需要逐条确认是否已持久化）');
fs.writeFileSync('_scan_persist_gap.out.txt', out.join('\n'));
