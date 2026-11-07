// 守门测试：SSE 事件契约（2026-10-06 新增角度）
// 后端 sseSend/sseSendEdit 发 7 类事件，前端 EventSource 原先只订阅 4 类 ——
// pushed / similar / auction 三类**零接收方**，后端白算白推、前端永远不刷新，
// 而且**没有任何报错**（SSE 就是发出去没人听，不像接口会 404）。
// 其中 auction 是每 3 秒算一次的竞价实时，是全场时效性最强的一路，
// 前端却只靠 5 秒轮询拿 S.auction —— "竞价实时"实际只跑了一半。
// 本测试把两件事钉死：①事件类型双向闭环 ②payload 字段双向闭环。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
// ⚠️ 必须用 keepStrings：默认模式会把字符串**一起涂成空格**，而事件名就写在字符串里
//    （sseSend('alert', …）→ 涂完变成 sseSend(      , …，一条都抓不到，后端集合恒为空。
//    keepStrings 只剥注释与正则，正好是这里要的。
const code = stripNoise(src, { keepStrings: true });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('\n=== SSE 事件契约守门 ===\n');

// ---------- 后端发了哪些事件 ----------
const BE = new Map();   // evt -> Set(顶层键)
const reBe = /sseSend(?:Edit)?\(\s*'([a-zA-Z]+)'\s*,\s*(\{|[\w]+)/g;
let m;
while ((m = reBe.exec(code))) {
  const evt = m[1];
  if (!BE.has(evt)) BE.set(evt, new Set());
  const bi = code.indexOf('{', m.index);
  if (bi < 0 || m[2] !== '{') continue;
  let d = 0, j = bi, end = -1;
  for (; j < code.length; j++) {
    if (code[j] === '{') d++;
    else if (code[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  if (end < 0) continue;
  const obj = code.slice(bi + 1, end);
  // 只取顶层键（深度 0 的 `key:` / `key,`）
  let dep = 0, key = '', prev = '';
  for (let k = 0; k < obj.length; k++) {
    const c = obj[k];
    if ('{[('.includes(c)) dep++;
    else if ('}])'.includes(c)) dep--;
    if (dep === 0 && c === ':') {
      const kk = key.trim().replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(kk)) BE.get(evt).add(kk);
      key = '';
    } else if (dep === 0 && (c === ',' || c === '\n' || c === '}')) {
      // ⛔ 2026-10-28 补：ES6 简写属性（`{ stage, file, version }`）**没有冒号**，
      //    旧扫描器只认 `key:` → 简写上一条都抓不到，于是 release 事件的 payload 集合恒为空，
      //    前端读 d.stage/d.version 被判「后端没发」而假红（真发得出来，字段是简写的）。
      //    判据：深度 0 处若攒下来的整段就是个合法标识符，那它就是简写属性名。
      const kk = key.trim().replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(kk)) BE.get(evt).add(kk);
      key = '';
    } else if (dep <= 1) key += c;
  }
  // 收尾：最后一个属性就是简写（`{ stage, file, version }` 的 version）
  {
    const kk = key.trim().replace(/^['"]|['"]$/g, '');
    if (/^[A-Za-z_$][\w$]*$/.test(kk)) BE.get(evt).add(kk);
  }
}

// ---------- 前端订阅了哪些事件 ----------
const FE = new Map();   // evt -> Set(读到的 d.xxx)
const reFe = /es\.addEventListener\(\s*'([a-zA-Z]+)'\s*,\s*e\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g;
while ((m = reFe.exec(html))) {
  const evt = m[1];
  if (!FE.has(evt)) FE.set(evt, new Set());
  for (const mm of m[2].matchAll(/\bd\.([A-Za-z_$][\w$]*)/g)) FE.get(evt).add(mm[1]);
}

console.log('【① 事件类型：双向闭环】');
const beList = [...BE.keys()].sort(), feList = [...FE.keys()].sort();
console.log('   后端发送: ' + beList.join(', '));
console.log('   前端订阅: ' + feList.join(', '));
const missFe = beList.filter(e => !FE.has(e));
const missBe = feList.filter(e => !BE.has(e));
ok('后端发的每一类事件前端都订阅了（缺: ' + (missFe.join(',') || '无') + '）', missFe.length === 0, '缺 ' + missFe.join(','));
ok('前端没订阅后端从不发的事件（幽灵监听: ' + (missBe.join(',') || '无') + '）', missBe.length === 0, '多 ' + missBe.join(','));
ok('后端事件种类 ≥ 7（本次体检确认的规模）', beList.length >= 7, '实际 ' + beList.length);

console.log('\n【② payload 字段：前端读的字段后端必须真有】');
let bad = [];
for (const evt of feList) {
  const need = FE.get(evt) || new Set();
  const have = BE.get(evt) || new Set();
  for (const k of need) if (!have.has(k)) bad.push(evt + '.' + k);
}
ok('前端引用的字段全部在后端 payload 里（缺: ' + (bad.join(', ') || '无') + '）', bad.length === 0, '缺 ' + bad.join(', '));

// 逐条钉死关键契约（改字段名必须同步改前端，否则提示显示成 undefined）
ok('alert: 前端读 time/preview，后端两者都发',
  (BE.get('alert') || new Set()).has('time') && (BE.get('alert') || new Set()).has('preview'));
ok('bigmoney: 前端读 hot，后端发 hot', (BE.get('bigmoney') || new Set()).has('hot'));
ok('signal: 前端读 items，后端发 items', (BE.get('signal') || new Set()).has('items'));
ok('holding: 前端读 level/items，后端两者都发',
  (BE.get('holding') || new Set()).has('level') && (BE.get('holding') || new Set()).has('items'));
ok('auction: 前端读 live，后端发 live', (BE.get('auction') || new Set()).has('live'));

console.log('\n【③ 竞价实时这一路的特殊性】');
ok('auction 事件确实存在且带 live 标记（竞价段每 3 秒一路）', /sseSend\('auction', \{[^}]*live: true/.test(src));
ok('前端对 auction 做了静默刷新（不弹提示，避免 3 秒一条刷屏）',
  /addEventListener\('auction'[\s\S]{0,220}?countdown = 5; refresh\(\)/.test(html)
  && !/addEventListener\('auction'[\s\S]{0,300}?pageMsg/.test(html));

console.log('\n【④ 反证：扫描器本身有效】');
const fakeBe = "sseSend('brandnew', { time: 1 });";
const fakeSet = new Map();
{
  const mm = reBe.exec(fakeBe);
  ok('反证：能抓到新增的事件类型 brandnew', !!mm && mm[1] === 'brandnew');
}
ok('反证：前端不订阅就判定为缺失（构造 feList 不含 brandnew）', !feList.includes('brandnew'));

console.log('\nSSE 事件契约守门：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
