'use strict';
// 守门：S.buzhang（补涨池）两种形态必须都能被消费
// ────────────────────────────────────────────────────────────────────────
// 事故（2026-10-09 fy 轮，重启后日志里撞见的）：
//   [nextplan-boot] 异常: (S.buzhang || []).forEach is not a function
//   [nextplan] 计算失败: (S.buzhang || []).forEach is not a function
//   写入端三处恒写**对象形态** `S.buzhang = { time, items }`（10141/10155/10224），
//   而 nextPlanUniverse 按**数组**读 → TypeError 直接把整个函数打断 → 次日作战计划一个字都出不来。
//   典型「同一份数据在不同模块被当不同东西」，且只在"有补涨票时"才炸，空池时反而不报错。
// 修法：收成唯一读取入口 buzhangItems()，两种形态都认，所有读取端走它。
// 钉的语义：
//   ① 对象形态 / 数组形态 / 空值，nextPlanUniverse 都必须不抛错且能吃到条目（行为断言，改写法不算回归）
//   ② 不许再有第三份形态判断（源码里不许再出现 `(S.buzhang || []).forEach`）
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

const SV = SRC.split('\n').filter(l => !/^\s*\/\//.test(l) && !l.startsWith('const APP_VER = ')).join('\n');
// ⛔ 括号配平取函数体，不许固定行号窗口
function takeFn(headerRe) {
  const i = SV.search(headerRe);
  if (i < 0) return '';
  let d = 0, j = SV.indexOf('{', i);
  if (j < 0) return '';
  for (let k = j; k < SV.length; k++) {
    if (SV[k] === '{') d++;
    else if (SV[k] === '}') { d--; if (d === 0) return SV.slice(i, k + 1); }
  }
  return '';
}
const BZ = takeFn(/function buzhangItems\(\) \{/);
const NP = takeFn(/function nextPlanUniverse\(\) \{/);
// nextPlanUniverse 在 lj 轮起会调 capTooSmall（全模块<40亿不选），沙箱里也得有它，
// 否则报的是「capTooSmall is not defined」——那是沙箱缺依赖，不是被测代码有 bug。
const CAP = takeFn(/function capTooSmall\(s\) \{/);
ok('buzhangItems 抠得出来', BZ.length > 50, String(BZ.length));
ok('nextPlanUniverse 抠得出来', NP.length > 300, String(NP.length));
ok('capTooSmall 抠得出来（沙箱依赖，抠不到说明函数改名了，测试要跟着改）', CAP.length > 20, String(CAP.length));

group('[1] 源码：不许再出现第三份形态判断');
// ⛔ 用剥注释的 SV 判：注释里引用事故代码原文不该把断言打红（2026-10-07 已踩过一次）
ok('不再有 (S.buzhang || []).forEach（这就是事故本体）', !/\(S\.buzhang \|\| \[\]\)\.forEach/.test(SV));
ok('nextPlanUniverse 走唯一入口 buzhangItems()', /buzhangItems\(\)\.forEach/.test(NP));
ok('复盘里也走同一个入口（不许各写一份 Array.isArray）', /const _bz = buzhangItems\(\);/.test(SV));

group('[2] 真跑：三种形态都能被消费');
function mk(S) {
  return new Function('S', 'A', BZ + '\n' + CAP + '\n' + NP + '\nreturn { buzhangItems, nextPlanUniverse };')(
    S, { isJunkName: (n) => /ST|退/i.test(String(n || '')) }
  );
}
function tryRun(buzhang) {
  try {
    const m = mk({ buzhang, ztPool: [], bigMoney: { items: [] }, trendPool: [], stocks: [] });
    const out = m.nextPlanUniverse();
    return { ok: true, froms: out.map(x => x.from), n: out.length };
  } catch (e) { return { ok: false, err: e.message }; }
}

const rObj = tryRun({ time: '15:40:00', items: [{ code: '000001', name: '甲股' }], empty: '' });
ok('对象形态 {time,items} 不抛错（事故形态）', rObj.ok, rObj.err);
ok('对象形态的条目真的进了候选池（from=补涨）', rObj.ok && rObj.froms.indexOf('补涨') >= 0, JSON.stringify(rObj.froms));

const rArr = tryRun([{ code: '000002', name: '乙股' }]);
ok('数组形态不抛错（老数据兼容）', rArr.ok, rArr.err);
ok('数组形态的条目也进候选池', rArr.ok && rArr.froms.indexOf('补涨') >= 0, JSON.stringify(rArr.froms));

const rEmpty = tryRun({ time: '15:40:00', items: [] });
ok('空 items 不抛错', rEmpty.ok, rEmpty.err);
ok('空 items 时不产生补涨条目', rEmpty.ok && rEmpty.froms.indexOf('补涨') < 0, JSON.stringify(rEmpty.froms));

const rNull = tryRun(undefined);
ok('S.buzhang 为空对象/undefined 不抛错（⛔ 判空要在转数字/取属性之前）', rNull.ok, rNull.err);

group('[3] 唯一入口本身');
const m = mk({ buzhang: { items: [{ code: '1' }] } });
ok('buzhangItems() 对象形态返回 items 数组', Array.isArray(m.buzhangItems()) && m.buzhangItems().length === 1);
const m2 = mk({ buzhang: [{ code: '2' }] });
ok('buzhangItems() 数组形态原样返回', Array.isArray(m2.buzhangItems()) && m2.buzhangItems().length === 1);
const m3 = mk({ buzhang: null });
ok('buzhangItems() 空值返回空数组（不是 undefined，调用方 .forEach 不会炸）',
  Array.isArray(m3.buzhangItems()) && m3.buzhangItems().length === 0);

console.log('\n──── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────');
process.exit(fail ? 1 : 0);
