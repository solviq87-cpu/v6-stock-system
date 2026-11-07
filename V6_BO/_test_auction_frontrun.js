// hn 轮守门测试：竞价家族「前置标注」防回归
//
// 用户质疑：竞价推送的票一直在变动、且多是涨停的，是不是"马后炮时候补的"。
// 事实：竞价推送全在 09:15-09:25 发出，09:30 才开盘、涨停只能在盘中发生，发出时票根本还没涨停，
//       所以是前置信号，不是事后补。本轮新增 auctionFrontRunNote() 在这五处推送正文统一加免责标注。
//
// 本守门钉的是语义，不是脆弱字符串：
//   ① helper 真实可被 new Function 实例化并调用，返回的标注含全部关键免责文案；
//   ② 注入点数量 = 定义 1 + 调用 5（竞价家族全部 5 个出口：强势票/异动有效样本/9:20预览/一进二竞价确认/连板梯队扫描）；
//   ③ 竞价家族标题锚点仍在（标题/分类口径稳定，没被改动偷偷改掉）。
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }
function ng(name, why) { fail++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); }

// 抽取 function 的函数体（不含外层花括号）：带字符串/模板串/注释跳过的 brace-balance，
// 否则模板串里的 ${...} / 引号会骗过裸花括号计数。
function findFuncBody(src, keyword) {
  const s = src.indexOf(keyword);
  if (s < 0) return null;
  const i = src.indexOf('{', s);
  if (i < 0) return null;
  let depth = 0, inStr = null, inTmpl = false, escaped = false, inLineC = false, inBlockC = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inLineC) { if (c === '\n') inLineC = false; continue; }
    if (inBlockC) { if (c === '*' && src[j + 1] === '/') { inBlockC = false; j++; } continue; }
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (inTmpl) { if (c === '`') inTmpl = false; continue; }
    if (c === '/' && src[j + 1] === '/') { inLineC = true; continue; }
    if (c === '/' && src[j + 1] === '*') { inBlockC = true; j++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { inTmpl = true; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

const body = findFuncBody(SRC, 'function auctionFrontRunNote(');
if (body === null) {
  ng('auctionFrontRunNote 定义存在');
} else {
  ok('auctionFrontRunNote 定义存在');
  let fn = null;
  try { fn = new Function('function auctionFrontRunNote(timeStr){' + body + '\n}\nreturn auctionFrontRunNote;'); } catch (e) { fn = null; }
  if (!fn) {
    ng('helper 可被实例化并调用');
  } else {
    let ret = null;
    try { ret = fn()('09:25:00'); } catch (e) { ret = null; }
    if (typeof ret !== 'string' || ret.length === 0) ng('helper 返回非空字符串');
    else ok('helper 返回非空字符串（' + ret.length + ' 字）');
    const must = [
      '开盘前竞价时段(09:15-09:25)虚拟匹配价选出',
      '非盘中追涨',
      '09:30 开盘后才知能否真涨停',
      '本推送不等同买入建议',
    ];
    let allIn = true;
    for (const m of must) if (!ret || ret.indexOf(m) < 0) { allIn = false; break; }
    if (allIn) ok('标注含全部关键免责文案（前置信号 / 非盘中追涨 / 非买入建议）');
    else ng('标注文案缺失关键免责项', 'ret=' + JSON.stringify(ret));
    // 快照时间插值也能正常工作（传入 timeStr 应出现「快照 ...」）
    let withTime = null;
    try { withTime = fn()('09:25:10'); } catch (e) { withTime = null; }
    if (withTime && withTime.indexOf('快照 09:25:10') >= 0) ok('快照时间插值生效（传入 timeStr 出现在标注中）');
    else ng('快照时间插值未生效');
  }
}

// ② 调用点数量：定义 1 + 5 处注入 = 6
const calls = (SRC.match(/auctionFrontRunNote\s*\(/g) || []).length;
if (calls === 6) ok('已注入全部 5 个竞价家族出口（定义+5 调用）');
else ng('调用点数量应为 5，实际 ' + (calls - 1), '匹配 ' + calls + ' 处');

// ③ 竞价家族标题锚点仍在（标题/分类口径稳定）
const titles = [
  '═══ 🎯 一进二 · 竞价确认 ═══',
  '═══ 🔥 竞价异动 · 连板梯队扫描 ═══',
  '竞价强势票',
  '竞价异动',
  '竞价预览',
];
let titleOk = true, miss = '';
for (const t of titles) if (SRC.indexOf(t) < 0) { titleOk = false; miss = t; break; }
if (titleOk) ok('竞价家族标题锚点未变（分类口径稳定）');
else ng('竞价家族标题锚点缺失', miss);

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail > 0 ? 1 : 0;
