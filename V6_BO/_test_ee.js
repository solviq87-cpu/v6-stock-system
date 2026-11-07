// 守门：ee 轮 —— 兜底值与空值语义的一致性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 兜底值与空值语义一致性（ee 轮）守门 ===\n');

// ---------- ① marketReady 定义与使用规范 ----------
console.log('【① marketReady() 定义与使用规范】');
ok('marketReady 定义存在', /const marketReady\s*=\s*\(\)\s*=>\s*\(S\.stocks\s*\|\|\s*\[\]\)\.length\s*>\s*0/.test(SRC));
ok('marketReady 用于清空结果池（bigMoney）', /if\s*\(\s*marketReady\(\)\s*\)\s*\{[^}]*S\.bigMoney\s*=/.test(SRC));
ok('marketReady 用于清空结果池（nextplan）', /if\s*\(\s*marketReady\(\)\s*\)\s*\{[^}]*S\.nextplan\s*=/.test(SRC));
ok('marketReady 用于清空结果池（myrules）', /if\s*\(\s*marketReady\(\)\s*\)\s*\{[^}]*S\.myrules\s*=/.test(SRC));
// ⛔ 2026-10-27 mp 轮改钉：复盘空池从「marketReady()」换成更严的「poolConfirmedEmpty()」
//    （= marketReady() && 涨停池确实拉过 && 20 分钟内），语义只强不弱，旧正则钉死
//    marketReady 字样于是假红。这里接受两者任一，并额外断言「更严的那个确实包含 marketReady」。
ok('marketReady 用于清空结果池（review）', /if\s*\(\s*(?:marketReady|poolConfirmedEmpty)\(\)\s*\)\s*\{[^}]*S\.review\s*=/.test(SRC));
// ⛔ 2026-10-28 硬化：这条断言原来在【带注释的源码】上跑 160 字窗口，而 poolConfirmedEmpty 体内
//    2026-10-28 补的两段说明共 200+ 字 → 窗口被注释撑爆，语义没变却假红。
//    守门该钉「代码语义」不是「注释有多长」，故改用去注释源码（窗口仍留 160 字，够覆盖同一函数体）。
const SRC_NC = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok('review 清空守卫用的是「行情就绪」语义（更严的 poolConfirmedEmpty 也蕴含 marketReady）',
  /function poolConfirmedEmpty\(\)\s*\{[\s\S]{0,160}marketReady\(\)/.test(SRC_NC));
ok('marketReady 用于清空结果池（pre）', /if\s*\(\s*marketReady\(\)\s*\)\s*\{[^}]*S\.pre\s*=/.test(SRC));
ok('marketReady 用于清空结果池（buzhang）', /if\s*\(\s*marketReady\(\)\s*\)\s*\{[^}]*S\.buzhang\s*=/.test(SRC));

// ---------- ② cfgSetOf 是 CFG_SET 的唯一读取入口 ----------
console.log('\n【② cfgSetOf 是 CFG_SET 唯一读取入口】');
ok('cfgSetOf 实现存在', /function cfgSetOf\(k\)/.test(SRC));
ok('cfgSetOf 对未定义键返回 undefined', /if\s*\(!d\)\s*return\s+undefined/.test(SRC));
ok('cfgSetOf 把 null/空串当未配置', /v === undefined \|\| v === null \|\| v === ''/.test(SRC));
ok('cfgSetOf int 下界钳在 0', /Math\.max\(0,\s*n\)/.test(SRC));
ok('cfgSetOf 用上界兜住手改大值', /Math\.min\(d\.max/.test(SRC));

// ---------- ③ panelNotes 承诺与常量一致 ----------
console.log('\n【③ panelNotes 承诺与常量一致】');
const pnMatch = SRC.match(/function panelNotes\(\)\s*\{([\s\S]*?)\n\}/);
const pnBody = pnMatch ? pnMatch[1] : '';
ok('panelNotes 存在', pnBody.length > 50);
// BUZHANG_PUSH_PROB
const bbpConst = (SRC.match(/const BUZHANG_PUSH_PROB\s*=\s*(\d+)/) || [])[1];
const bbpInPn = pnBody.match(/buzhangN:\s*(\d+|BUZHANG_PUSH_PROB)/);
ok('buzhangN 与常量一致', bbpConst && bbpInPn &&
  (bbpInPn[1] === bbpConst || bbpInPn[1] === 'BUZHANG_PUSH_PROB'),
  `常量${bbpConst} vs panelNotes${bbpInPn ? bbpInPn[1] : '?'}`);
// ZT_INFER_PUSH_PROB
const ztipConst = (SRC.match(/const ZT_INFER_PUSH_PROB\s*=\s*(\d+)/) || [])[1];
// ⛔ 2026-10-28 硬化：闸门已从 ZT_INFER_PUSH_PROB(55) 换成 auczt 专用的 AUCZT_PUSH_PROB(18)，
//    panelNotes().ztInferN 跟着改是**对的**（L1220 明确「ZT_INFER_PUSH_PROB 原值不动、auczt 走本常量」）。
//    断言本意不是钉某个常量名，而是钉「panelNotes 必须引用常量、不许写死数字」——将来再换常量名也不该假红。
const ztipInPn = pnBody.match(/ztInferN:\s*(\d+|[A-Z][A-Z0-9_]*)/);
ok('ztInferN 引用常量而非写死数字（阈值调整不许漏改面板口径）', ztipConst && ztipInPn &&
  (ztipInPn[1] === ztipConst || /^[A-Z][A-Z0-9_]*$/.test(ztipInPn[1])),
  `常量${ztipConst} vs panelNotes${ztipInPn ? ztipInPn[1] : '?'}`);
// gate 文案里的胜率门是函数调用（动态值），确认不是写死数字
// ⛔ go 轮 C2：改调 pushMinProbEff()（偏冷环境 +8 的生效值）—— 两种形态都认，
//    钉的是"调函数不写死"这个语义，不是函数名。
ok('gate 承诺调用胜率门函数而非写死数字',
  /gate:\s*`.*/.test(pnBody) && /pushMinProb(?:Eff)?\(\)/.test(pnBody));

// ---------- ④ _govCfg 不收第二参数（唯一入口） ----------
console.log('\n【④ _govCfg 规范】');
const govMatch = SRC.match(/function _govCfg\(k[^)]*\)\s*\{/);
const govMatch2 = SRC.match(/const _govCfg\s*=\s*k\s*=>/);
ok('_govCfg 定义存在', !!(govMatch || govMatch2));
if (govMatch || govMatch2) {
  const anchor = (govMatch || govMatch2)[0];
  const govStart = SRC.indexOf(anchor);
  const govEnd = SRC.indexOf('\n};', govStart) + 3;
  const govBody = SRC.slice(govStart, govEnd);
  // 排除注释行（以 // 开头）中的误匹配
  const srcNoComment = SRC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok('_govCfg 只有 k 一个参数', !/_govCfg\s*\(\s*[^)]+,/.test(srcNoComment));
}

// ---------- ⑤ numNeutral 是唯一数字中性入口 ----------
console.log('\n【⑤ numNeutral 数字中性入口】');
ok('numNeutral 函数存在', /function numNeutral\(/.test(SRC));
ok('numNeutral 对未登记键报警并返回 Number(raw)||0',
  /console\.error\('\[numNeutral\] 未登记的字段/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
