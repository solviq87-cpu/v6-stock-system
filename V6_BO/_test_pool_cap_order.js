// 守门：精选池「池上限」与「八字闸门评估窗」必须是两个不同的数，且截断必须在闸门之后
// 钉的语义（2026-10-28 选股体系会话）：
//   ① 池上限 = 50（POOL_CAP），评估窗必须**更宽**（POOL_BAZI_WINDOW > POOL_CAP）；
//   ② 闸门前的截断只能用评估窗，不许再拿池上限直接截 —— 否则被「高位加速/破位整理」踢掉的
//      名额不会回填：达标候选 60 只时会白白只剩 45 只，闸门从"剔除坏的"变成"顺带减总数"；
//   ③ 真正的池上限截断（slice(0, POOL_CAP)）必须出现在 baziBlocked 过滤**之后**；
//   ④ 降级退路仍守同一把尺子（只从「已过闸门且判得出」的票里挑），不许把判不出的放回来。
// 反证：把 POOL_CAP 截断挪回闸门前 → ③ 必红；把评估窗改成 = 池上限 → ② 必红。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}

const at = SV.indexOf('async function rebuildPool');
ok(at > 0, 'rebuildPool 可定位');
const body = at > 0 ? bodyAt(SV, at) : '';
ok(body.length > 3000, 'rebuildPool 函数体可提取', String(body.length));

group('① 池上限与评估窗是两个数');
const capM = body.match(/const POOL_CAP = (\d+)/);
ok(!!capM, 'POOL_CAP 常量存在（池上限不写在逻辑里）', capM ? '' : '未找到');
ok(!!capM && +capM[1] === 50, '池上限 = 50', capM ? capM[1] : '-');
const winM = body.match(/const POOL_BAZI_WINDOW = (\d+)/);
ok(!!winM, 'POOL_BAZI_WINDOW 常量存在（闸门评估窗）', winM ? '' : '未找到');
ok(!!winM && !!capM && +winM[1] > +capM[1], '评估窗严格大于池上限（否则闸门踢人就没有回填余量）',
  winM && capM ? `${winM[1]} vs ${capM[1]}` : '-');

group('② 闸门前只许用评估窗截断');
const gateIdx = body.indexOf('.filter(c => !baziBlocked(c))');
const preCapIdx = body.indexOf('slice(0, POOL_BAZI_WINDOW)');
const hardCapIdx = body.indexOf('slice(0, POOL_CAP)');
ok(gateIdx > 0, '八字闸门过滤可定位（!baziBlocked）', String(gateIdx));
ok(preCapIdx > 0 && gateIdx > preCapIdx, '闸门评估窗截断在闸门之前（先取宽窗、再过闸）',
  `pre=${preCapIdx} gate=${gateIdx}`);
ok(!/picked = picked\.slice\(0, 50\)/.test(body), '反证：不存在「picked.slice(0, 50)」硬编码池上限（易与评估窗混用）');

group('③ 池上限截断必须在闸门之后');
ok(hardCapIdx > 0, 'slice(0, POOL_CAP) 存在（最终池上限）', String(hardCapIdx));
ok(hardCapIdx > gateIdx, '池上限截断在八字闸门之后（被踢的名额才能回填）',
  `cap=${hardCapIdx} gate=${gateIdx}`);
const assignIdx = body.indexOf('S.candidatePool = picked');
ok(assignIdx > hardCapIdx && hardCapIdx > 0, '入池赋值在池上限截断之后（不会把超额部分直接落库）',
  `assign=${assignIdx} cap=${hardCapIdx}`);

group('④ 降级退路仍走同一把尺子');
ok(/const safe = scored\.filter\(c => !baziBlocked\(c\) && !baziUnknown\(c\)\)/.test(body),
  '退路只从「已过闸门且判得出」的票里挑（不把判不出的放回来）');
ok(/baziKicked = beforeGate - picked\.length/.test(body),
  '闸门拦下数如实统计（beforeGate 是过闸前基数，不受最终截断影响）');

console.log(`\n─── 结果：通过 ${pass} / 失败 ${fail} ───`);
process.exit(fail ? 1 : 0);
