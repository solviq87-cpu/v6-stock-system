// 扫描器 · do 轮第七遍：/api/state 里「被 slice 截断的数组」，
//   与前端拿它的 .length 当「总数」展示的地方 —— 截断后长度 ≠ 真实总数，
//   面板就会说「共 50 只」而实际 60 只（dn 轮补发收了 outN 那 10 个池，这批没收到）。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const SL = SV.split('\n');

// ① /api/state 起点
const s0 = SV.indexOf("if (p === '/api/state')");
const blk = SV.slice(s0, s0 + 9000);
console.log('【①】/api/state 里带 slice 截断的数组字段');
const cuts = [];
blk.split('\n').forEach((l, i) => {
  const m = l.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(.*)/);
  if (!m) return;
  const key = m[1], expr = m[2];
  const sm = expr.match(/\.slice\(\s*0\s*,\s*(\d+)\s*\)/);
  if (sm) {
    cuts.push({ key, cap: +sm[1], expr: expr.trim().slice(0, 76), line: s0 + i });
    console.log('   %s  上限 %d   ← %s', key.padEnd(16), +sm[1], expr.trim().slice(0, 76));
  }
});

// ② 前端拿这些键的 .length 当条数展示
console.log('\n【②】前端把这些键的 .length 直接显示成「N 只 / 共 N」的地方');
for (const c of cuts) {
  const re = new RegExp('s\\.' + c.key + '\\b[^\\n]{0,90}', 'g');
  let m; let hit = 0;
  while ((m = re.exec(HV))) {
    const seg = m[0];
    if (/\.length/.test(seg) && /(只|共|条|家)/.test(seg)) {
      hit++;
      const line = HV.slice(0, m.index).split('\n').length;
      console.log('   ⚠ s.%s  html:%d  %s', c.key, line, seg.trim().slice(0, 110));
    }
  }
  if (!hit) console.log('   · s.%s  前端未用 .length 展示条数', c.key);
}

// ③ 还有没有「总数键」与「数组键」并存（同源两个数）
console.log('\n【③】state 里「总数键」与「数组键」并存的');
const keys = [...blk.matchAll(/^\s{4,6}([A-Za-z_$][\w$]*)\s*:/gm)].map(x => x[1]);
const arrKeys = cuts.map(c => c.key);
for (const k of keys) {
  const low = k.toLowerCase();
  if (/size|count|total|n$/.test(k)) {
    // 找它对应的数组键
    const base = k.replace(/(Size|Count|Total|N)$/i, '');
    const cand = arrKeys.find(a => a.toLowerCase() === base.toLowerCase() ||
                                  a.toLowerCase().startsWith(base.toLowerCase()));
    console.log('   总数键 %s → 对应数组键 %s', k.padEnd(14), cand || '(未找到)');
  }
}

// ④ 前端所有「共 N 只 / N 只」里，N 来自数组 .length 的（无论是否截断）
console.log('\n【④】前端条数展示里直接数数组 .length 的全部位置');
{
  const re = /\$\{([^}]{0,60}\.length[^}]{0,40})\}[^`]{0,12}(只|条|家)/g;
  let m; let n = 0;
  while ((m = re.exec(HV))) {
    n++;
    const line = HV.slice(0, m.index).split('\n').length;
    console.log('   html:%d  ${%s} %s', line, m[1].trim(), m[2]);
  }
  if (!n) console.log('   （无）');
}
