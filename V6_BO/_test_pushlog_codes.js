// kb 轮守门：推送消息里的股票代码要落盘到 pushlog.extra，
// 让每日收盘后能复盘竞价共振/相似走势/利好消息等所有渠道的命中率。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, 'got ' + JSON.stringify(a) + ' / expected ' + JSON.stringify(b)); }

// ── 从源码原样抽出 extractStockCodes，在沙箱里跑 ──
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}
const decl = 'function extractStockCodes(text)';
const i = SV.indexOf(decl);
if (i < 0) throw new Error('未找到 extractStockCodes');
const body = decl + bodyAt(SV, i);
const extract = new Function(`${body}; return extractStockCodes;`)();

// ── ① 常规提取 ──
eq(JSON.stringify(extract('💰 大单流入 · 启明星辰(002439)\n现价 12.34')),
  JSON.stringify(['002439']), 'C1 从括号里提取 6 位代码');
eq(JSON.stringify(extract('002439 与 600519 两只票')),
  JSON.stringify(['002439','600519']), 'C2 提取多个代码');
eq(JSON.stringify(extract('科创板 688981 与 688012')),
  JSON.stringify(['688981','688012']), 'C3 支持 688 开头');
eq(JSON.stringify(extract('没有代码，只有 10 分钟和 30%')),
  JSON.stringify([]), 'C4 不提取非 6 位数字');
eq(JSON.stringify(extract('版本 20261023ka 不会误当成代码')),
  JSON.stringify([]), 'C5 8 位版本号不误匹配');

// ── ② pushAll 里所有 pushLog 调用都经过 _extra ──
const pushAllDecl = 'function pushAll(text, force, opts) {';
const ai = SV.indexOf(pushAllDecl);
if (ai < 0) throw new Error('未找到 pushAll');
let depth = 0, end = -1;
for (let k = ai; k < SV.length; k++) {
  if (SV[k] === '{') depth++;
  else if (SV[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const pushAllBody = SV.slice(ai, end + 1);
// 找出 pushAll 体内的所有 pushLog( 调用
const calls = [];
let p = 0;
while ((p = pushAllBody.indexOf('pushLog(', p)) !== -1) {
  const start = p;
  let d = 0, q = p;
  for (; q < pushAllBody.length; q++) {
    const ch = pushAllBody[q];
    if (ch === '(') d++;
    else if (ch === ')') { d--; if (d === 0) { q++; break; } }
  }
  calls.push(pushAllBody.slice(start, q));
  p = q;
}
ok(calls.length > 0, 'C6 抽取出 pushAll 体内的 pushLog 调用');
for (const c of calls) {
  ok(/_extra\(\{/.test(c), 'C7 pushLog 调用经过 _extra 包装：' + c.slice(0, 60));
}

// ── ③ _extra 把 codes 嵌到 extra 对象里（cloud.js 只映射 rec.extra）──
const extraDecl = 'const _extra = base => Object.assign({}, base, { extra: { codes: _codes } });';
ok(SV.indexOf(extraDecl) >= 0, 'C8 _extra 将 codes 写入 extra.codes 以便云端同步');

// ── ④ 模拟 pushLog 落盘形状：extra 被摊平后 rec.extra.codes 存在 ──
const sampleRec = { time: 't', ts: 1, status: 's', title: 'title' };
const sampleExtra = Object.assign({}, { note: 'n' }, { extra: { codes: extract('命中 002594 与 300750') } });
Object.assign(sampleRec, sampleExtra);
ok(Array.isArray(sampleRec.extra && sampleRec.extra.codes) && sampleRec.extra.codes.length === 2,
  'C9 模拟落盘记录存在 rec.extra.codes');

// ── 汇总 ──
console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
