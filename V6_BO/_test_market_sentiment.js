// 守门：市场情绪一行研判（in 轮回退：从 ia 轮独立大卡改为盘面总览内一行研判）
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('FAIL:', m); } }

// ① 后端 marketMood 返回 advice + evidence
ok(/function marketMood\(\)/.test(SV), '① marketMood 函数存在');
ok(/advice.*evidence/.test(SV), '② marketMood 返回含 advice 与 evidence');
ok(/let advice = /.test(SV), '③ advice 有计算逻辑');
ok(/const evidence = /.test(SV), '④ evidence 是数组');
ok(/'加仓'/.test(SV) && /'减仓'/.test(SV) && /'空仓'/.test(SV) && /'观望'/.test(SV),
  '⑤ 建议四档齐全（加仓/减仓/空仓/观望）');

// ② 前端一行研判（in 轮回退：不再有独立 moodCard 大卡，改为 moodLine 行内 moodBox）
ok(!HTML.includes('id="moodCard"'), '⑥ 无独立 moodCard 大卡（in 轮回退为一行研判）');
ok(HTML.includes('id="moodBox"'), '⑦ HTML 含 moodBox 一行研判容器');
ok(!HTML.includes('id="moodTime"'), '⑧ 无独立 moodTime（时间信息并入一行研判）');

// ③ 前端渲染逻辑读取 preselect.mood.advice / evidence
ok(/mood\.advice/.test(HTML), '⑨ 前端读取 mood.advice');
ok(/mood\.evidence/.test(HTML), '⑩ 前端读取并合并 mood.evidence 要点');
ok(/市场情绪/.test(HTML), '⑪ 盘面总览含市场情绪一行研判');

// ④ /api/state 继续下发 preselect（已有契约，验证未被删除）
ok(/preselect: S\.preselect/.test(SV), '⑫ /api/state 下发 preselect（含 mood）');

// ⑤ ie 轮：情绪卡与 preselect 解耦（前端读 s.mood，后端独立下发 mood）
ok(/mood: marketMood\(\)/.test(SV), '⑬ /api/state 独立下发 mood 字段（调用 marketMood）');
ok(!/s\.preselect\.mood/.test(HTML), '⑭ 前端不再读 s.preselect.mood（已解耦到 s.mood）');
const _mi = SV.indexOf('function marketMood()');
const _mj = SV.indexOf('// ═══ go 轮', _mi);
const _mbody = SV.slice(_mi, _mj);
ok(_mbody && !/preselect|candidatePool/.test(_mbody), '⑮ marketMood 不读 preselect/candidatePool（情绪研判与预选无关）');

console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
