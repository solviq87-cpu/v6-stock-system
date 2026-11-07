// 扫描器：列出所有「会往手机推消息」的入口（定时器 / 手动接口），标出哪些推了却没打当日闭锁。
// 判据：一个入口里出现 pushAll( / pushWecom(，就应该在同一段里看到 `*Date = todayStr()` /
// `*Date = ds` 之类的置位（同一条消息一天只发一次的那些）。没看到 = 手动补发会被自动任务重放。
// 例外：只推「失败提示 / 通道自检 / 测试消息 / 私密凭证」的入口不需要置位，靠名字白名单排除。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

// 不需要「当日闭锁」的入口：失败提示 / 通道自检 / 测试消息 / 一次性凭证 / 事件驱动的通知
// （事件驱动的如「只读设备申请审批结果」，一天内本来就可能有多条，按天闭锁反而是错的）
const NO_LOCK_OK = /自检|测试|样例|失败|报错|授权码|验证码|密码|复位|放通|通知|报平安|源码包|持仓已清空|私密|占位已退回|审批|申请|放行|已通过|已拒绝/;

// 按「路由行 / 定时器行」切段
const marks = [];
const re = /(if \(p === '\/api\/[a-z0-9\/-]+'|setInterval\(|setTimeout\()/g;
let m;
while ((m = re.exec(SVK))) marks.push({ i: m.index, head: m[1] });
marks.push({ i: SVK.length, head: '(EOF)' });

const rows = [];
for (let k = 0; k < marks.length - 1; k++) {
  const body = SVK.slice(marks[k].i, marks[k + 1].i);
  const pushes = (body.match(/\b(?:pushAll|pushWecom)\s*\(/g) || []).length;
  if (!pushes) continue;
  // ⚠️ 末尾不能加 \b：`todayStr();` 后面是分号，) 与 ; 都是非单词字符，中间没有词边界 → 恒不匹配
  const lock = /\b[a-zA-Z]*Date\s*=\s*(?:todayStr\(\)|ds)/.test(body);
  rows.push({
    head: marks[k].head.slice(0, 42),
    pushes,
    lock,
    ok: lock || NO_LOCK_OK.test(body),
  });
}

console.log('会推消息的入口（共 ' + rows.length + ' 处）：\n');
for (const r of rows) {
  console.log((r.ok ? '   ' : '⚠️ ') + r.head.padEnd(44) + ' push×' + String(r.pushes).padEnd(3) +
    (r.lock ? '已置当日闭锁 ✅' : (r.ok ? '无需置位 ☑（失败提示/自检/凭证类）' : '未置位 ⚠️')));
}
const bad = rows.filter(r => !r.ok);
console.log('\n推了却没打闭锁、且不属于例外：' + bad.length + ' 处' +
  (bad.length ? ' → ' + bad.map(r => r.head).join('、') : ''));
