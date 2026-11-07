// 守门：一进二 / 二进三「主流板块」硬闸门（ge 轮 / 2026-10-10）
// ── 起因 ──────────────────────────────────────────────────────────────
// 用户原话「一进二 二进三我希望你是有依据的选股 不是瞎推送 要是主流板块的」。
// 旧逻辑主线强度只是「弱主线 −3 分」的软惩罚，孤立冷门板块的票其他因子够强照样入选 → 瞎推。
// 修法：新增 isMainlineStock 硬闸门，候选所属主线必须是当日主流板块（S.mainline Top5）
//   或强度达中档(>=40)，否则落选；why 里写「主流·<依据>」，前端显「主流板块」蓝徽标。
// ── 本套件钉死 ────────────────────────────────────────────────────────
//   ① 闸门判据正确（主流命中 / 中档兜底 / 弱主线落选 / 无主流数据兜底）
//   ② 两个选股入口都真的调用闸门，且非主流时 continue 落选
//   ③ 入选票带 mainline:true + mainlineBasis 依据字段（前端徽标 + 复盘可查）
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

// ⛔ 括号配平取函数体，不许固定字符窗口（踩过 9 次）
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('{', i);
  if (j < 0) return '';
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

const bGate = fnBody(s, 'function isMainlineStock');
ok('isMainlineStock 函数体可定位', bGate.length > 200, String(bGate.length));

// 真跑闸门：把 S.mainline 与 secStrength 注入沙箱（闸门只依赖 S.mainline 与入参，自包含）
function runGate(mainline, secStrength, z) {
  const S = { mainline };
  const fn = new Function('S', 'function isMainlineStock(z, secStrength)' + bGate + '\nreturn isMainlineStock;');
  return fn(S)(z, secStrength);
}

console.log('\n① 闸门判据：主流命中 / 中档兜底 / 弱主线落选 / 无主流数据兜底');
{
  const ml = { items: [{ sector: '电池·储能', count: 9, maxLb: 4 }, { sector: '光伏', count: 8, maxLb: 3 }] };
  const r1 = runGate(ml, { theme: '电池·储能', score: 50 }, { sector: '电池·储能' });
  ok('主线在当日主流榜 → 入选', r1.ok === true, JSON.stringify(r1));
  ok('入选依据写明「当日主流·同主线涨停N只·最高M板」',
    /当日主流/.test(r1.reason) && /同主线涨停9只/.test(r1.reason) && /最高4板/.test(r1.reason), r1.reason);

  // 中档兜底：不在 Top5，但强度达中(>=40)
  const r2 = runGate(ml, { theme: '创新药', score: 45 }, { sector: '创新药' });
  ok('非 Top5 但主线强度>=40(中档) → 入选(准主流兜底)', r2.ok === true, JSON.stringify(r2));
  ok('兜底依据写明「准主流」', /准主流/.test(r2.reason), r2.reason);

  // 弱主线落选
  const r3 = runGate(ml, { theme: '服装家纺', score: 22 }, { sector: '服装家纺' });
  ok('弱主线(强度<40)且不在主流榜 → 落选', r3.ok === false, JSON.stringify(r3));
  ok('落选依据写明「非主流」', /非主流/.test(r3.reason), r3.reason);

  // 无主流数据兜底到分数：S.mainline 为 null，弱主线仍落选（不乱推）
  const r4 = runGate(null, { theme: 'X板块', score: 20 }, { sector: 'X板块' });
  ok('无主流板块数据 + 弱主线 → 落选（不乱推）', r4.ok === false, JSON.stringify(r4));
  const r5 = runGate(null, { theme: 'Y板块', score: 55 }, { sector: 'Y板块' });
  ok('无主流板块数据 + 强度>=40 → 仍入选（按强度兜底，不误杀）', r5.ok === true, JSON.stringify(r5));
}

console.log('\n② 两个选股入口都真的调用闸门，非主流时 continue 落选');
{
  const bYi = fnBody(s, 'function scanYiEr() {');
  const bLb = fnBody(s, 'function scanLianbanRelay() {');
  ok('一进二调用 isMainlineStock 闸门', /isMainlineStock\(z, secStrength\)/.test(bYi));
  ok('连板接力调用 isMainlineStock 闸门', /isMainlineStock\(z, secStrength\)/.test(bLb));
  // ⛔ 闸门之后必须 continue（不写 continue = 弱主线照样进候选 = 瞎推）
  const yiGate = bYi.indexOf('isMainlineStock(z, secStrength)');
  const yiCont = bYi.indexOf('if (!_ml.ok) continue;', yiGate);
  ok('一进二：非主流直接 continue 落选', yiGate >= 0 && yiCont >= 0 && yiCont > yiGate, 'gate@' + yiGate + ' cont@' + yiCont);
  const lbGate = bLb.indexOf('isMainlineStock(z, secStrength)');
  const lbCont = bLb.indexOf('if (!_ml.ok) continue;', lbGate);
  ok('连板接力：非主流直接 continue 落选', lbGate >= 0 && lbCont >= 0 && lbCont > lbGate, 'gate@' + lbGate + ' cont@' + lbCont);
  // 入选依据写进 why（不瞎推，每只能说出理由）
  ok('一进二把主流依据写进 why（主流·<依据>）', /why\.push\('主流·' \+ _ml\.reason\)/.test(bYi));
  ok('连板接力把主流依据写进 why', /why\.push\('主流·' \+ _ml\.reason\)/.test(bLb));
}

console.log('\n③ 入选票带可见依据字段（前端「主流板块」蓝徽标 + 复盘可查）');
{
  const bYi = fnBody(s, 'function scanYiEr() {');
  const bLb = fnBody(s, 'function scanLianbanRelay() {');
  ok('一进二输出带 mainline:true', /mainline: true/.test(bYi) && /mainlineBasis: _ml\.reason/.test(bYi));
  ok('连板接力输出带 mainline:true', /mainline: true/.test(bLb) && /mainlineBasis: _ml\.reason/.test(bLb));
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  ok('前端消费 mainline 显「主流板块」蓝徽标', /x\.mainline \? [\s\S]*主流板块/.test(html));
  ok('卡片标题写明「仅主流板块入选」', /仅主流板块入选/.test(html));
}

console.log(`\n一进二/二进三·主流板块闸门守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
