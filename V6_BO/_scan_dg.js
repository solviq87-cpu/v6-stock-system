// dg 轮侦察：同一个键的「默认值 / 空值语义」在不同入口下是不是同一个
// 扫码四处：①S.config 初始对象 ②_govCfg 调用点字面量 ③裸读 S.config.X ④面板 index.html 的兜底与 placeholder
const fs = require('fs');
const D = __dirname;
const rd = f => fs.readFileSync(D + '/' + f, 'utf8');
const svRaw = rd('server.js');
const html = rd('public/index.html');

// 剥注释（保留行号结构）：去掉 // 之后的内容
function strip(src) {
  return src.split('\n').map(l => {
    const i = l.indexOf('//');
    return i >= 0 ? l.slice(0, i) : l;
  }).join('\n');
}
const SV = strip(svRaw);

// ① S.config 初始对象
const initObj = {};
{
  const m = SV.match(/config:\s*\{[\s\S]{0,400}?\}/);
  if (m) {
    for (const mm of m[0].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?)/g)) initObj[mm[1]] = +mm[2];
  }
}
console.log('【① S.config 初始对象里的数值键】', initObj);

// ② _govCfg('k', N) 调用点
const gov = {};
for (const m of SV.matchAll(/_govCfg\(\s*['"]([\w$]+)['"]\s*,\s*(-?[\d.]+)\s*\)/g)) {
  (gov[m[1]] = gov[m[1]] || new Set()).add(+m[2]);
}
console.log('\n【② _govCfg 调用点默认值】');
for (const k of Object.keys(gov)) console.log('  ', k, '→', [...gov[k]].join(' / '), [...gov[k]].length > 1 ? '  ⚠️ 分叉' : '');

// ③ 裸读 / || 兜底
const bare = {};
for (const m of SV.matchAll(/S\.config\.([A-Za-z_$][\w$]*)\s*\|\|\s*(-?[\d.]+)/g)) {
  (bare[m[1]] = bare[m[1]] || new Set()).add('||' + m[2]);
}
for (const m of SV.matchAll(/\(\s*S\.config\s*&&\s*S\.config\.([A-Za-z_$][\w$]*)\s*\)\s*\|\|/g)) {
  (bare[m[1]] = bare[m[1]] || new Set()).add('&&||');
}
for (const m of SV.matchAll(/\+\(\s*S\.config\.([A-Za-z_$][\w$]*)\s*\|\|\s*(-?[\d.]+)\s*\)/g)) {
  (bare[m[1]] = bare[m[1]] || new Set()).add('+()||' + m[2]);
}
console.log('\n【③ 非 _govCfg 的裸读 / || 兜底】', bare);

// ④ CFG_RANGE 表里登记的键
const rangeKeys = [];
{
  const i = SV.indexOf('const CFG_RANGE');
  if (i >= 0) {
    const blk = SV.slice(i, i + 2200);
    for (const m of blk.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*\{/gm)) rangeKeys.push(m[1]);
  }
}
console.log('\n【④ CFG_RANGE 登记的键】', rangeKeys.join(', '));

// ⑤ probThreshold 专项：所有出现（剥注释版）
console.log('\n【⑤ probThreshold 全部出现（剥注释）】');
SV.split('\n').forEach((l, i) => {
  if (l.indexOf('probThreshold') >= 0) console.log('  L' + (i + 1) + ': ' + l.trim().slice(0, 140));
});

// ⑥ 面板里对 probThreshold 的使用
console.log('\n【⑥ index.html 里的 probThreshold】');
html.split('\n').forEach((l, i) => {
  if (l.indexOf('probThreshold') >= 0 && i + 1 !== 1428) console.log('  L' + (i + 1) + ': ' + l.trim().slice(0, 160));
});

// ⑦ 面板里止损/止盈/仓位的兜底数字
console.log('\n【⑦ index.html 止损止盈仓位相关兜底】');
html.split('\n').forEach((l, i) => {
  if (/stopPct|reducePct|takePct|maxPosPct/.test(l) && i + 1 !== 1428) console.log('  L' + (i + 1) + ': ' + l.trim().slice(0, 160));
});

// ⑧ 交叉判定：初始值 vs _govCfg 默认
console.log('\n【⑧ 交叉：初始对象有值 & _govCfg 也有默认 → 两处是不是同一个数】');
for (const k of Object.keys(initObj)) {
  if (gov[k] && !gov[k].has(initObj[k])) console.log('   ⚠️ ' + k + '：初始对象 ' + initObj[k] + '  vs _govCfg 默认 ' + [...gov[k]].join('/'));
}
console.log('   （初始对象里有数值的键共 ' + Object.keys(initObj).length + ' 个，其中走 _govCfg 的 ' + Object.keys(initObj).filter(k => gov[k]).length + ' 个）');
