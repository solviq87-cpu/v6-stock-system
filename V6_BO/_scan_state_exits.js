// 扫描器（cu 轮 · 角度：只在 happy path 上定义过的状态）
// 一个长任务有四种出口：成功 / 跳过（前提不满足）/ 失败（抛错）/ 已在跑（重入）。
// 若"进度/状态对象"只在成功那一支被更新，其余三支直接 return，那么：
//   · 面板显示的仍是上一次成功的数字，看起来"刚刚跑完"，实际可能是几小时前甚至昨天
//   · 没有任何字段能表达"这一轮没跑成"，故障 100% 无法自查（不报错、不算错，只是过时）
// 本扫描器找出"状态对象的写入点是否覆盖了所有出口"。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });
const lines = NOC.split('\n');

// 取函数体：先跳形参表（`extra = {}` 的花括号会骗计数），箭头函数不跳
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let pe = i;
  if (/^function\s/.test(sig)) {
    let p = src.indexOf('(', i), pd = 0;
    for (pe = p; pe < src.length; pe++) {
      const c = src[pe];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
  }
  let j = src.indexOf('{', pe), d = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return '';
}

console.log('════ 状态出口扫描：进度对象有没有覆盖"失败/跳过"分支 ════\n');

// 候选：全市场扫描类任务的进度对象
const PROGS = ['_zpProg', '_tsProg', '_kbfProg'];
for (const p of PROGS) {
  const writes = [];
  lines.forEach((l, i) => {
    // 写入点：赋值或整体替换
    if (new RegExp('(^|[^\\w$.])' + p + '\\s*=|' + p + '\\.\\w+\\s*=[^=]|Object\\.assign\\(' + p).test(l)) {
      writes.push({ line: i + 1, raw: l.trim().slice(0, 88) });
    }
  });
  console.log('【' + p + '】写入点 ' + writes.length + ' 处');
  writes.forEach(w => console.log('   L' + w.line + '  ' + w.raw));
  // 它的宿主函数有几个出口？数 return
  const host = p === '_zpProg' ? 'async function scanZtPre(' : (p === '_tsProg' ? 'async function scanTrendUniverse(' : 'async function klineBackfill(');
  const body = fnBody(NOC, host);
  const rets = (body.match(/\breturn\b/g) || []).length;
  // ⛔ 判据要精确：只看**定义字面量**里有没有 ok 字段。
  //    原先写成"名字后面 80 字符内出现 ok:"，会把邻近 `return { ok:false, prog: X }` 里的
  //    ok 算到它头上 → _kbfProg 明明没有 ok 字段却被判成"有"（本次实测的假绿）。
  // ⛔ 定义可能跟别的变量同一行（`let _zpBusy = false, _zpProg = { … }`）——
  //    用 `[^=]*` 会卡在第一个等号上匹配不到（本次实测 _zpProg 被误判"没有 ok 字段"）
  const defLine = (lines.find(l => new RegExp('(?:const|let)\\s[\\s\\S]{0,160}?\\b' + p + '\\s*=\\s*\\{').test(l)) || '');
  const hasOk = /\bok\s*:/.test(defLine);
  // 是否通过封装函数写入（tsProgSet / zpProgSet 这类），封装也算覆盖
  const viaHelper = new RegExp('function\\s+\\w*ProgSet\\([^)]*\\)\\s*\\{[^}]*' + p).test(NOC)
    || new RegExp('Object\\.assign\\(\\s*' + p + '\\b').test(NOC);
  console.log('   宿主函数 return 出口数 = ' + rets + ' ｜ 定义里带 ok 字段 = ' + (hasOk ? '是' : '否')
    + ' ｜ 走封装函数写入 = ' + (viaHelper ? '是' : '否'));
  console.log('   → ' + (hasOk && (writes.length >= 2 || viaHelper)
    ? '✅ 失败/跳过也会写状态' : '❌ 可能只在成功分支写（失败/跳过不留痕）'));
  console.log('');
}

// 反向：找出"只有一处写入"的状态对象（几乎必然是只写成功）
console.log('【反向】只被写一处的进度类对象（几乎必然只覆盖成功分支）');
const names = new Set();
lines.forEach(l => {
  const m = l.match(/(?:^|[^.\w$])(_?\w*[Pp]rog)\s*=/);
  if (m) names.add(m[1]);
});
for (const n of names) {
  const w = lines.filter(l => new RegExp('(^|[^\\w$.])' + n + '\\s*=|' + n + '\\.\\w+\\s*=[^=]').test(l)).length;
  // ⛔ 走封装函数（Object.assign(prog, …) / xxProgSet）写入的不算"只写一处"
  const viaHelper = new RegExp('Object\\.assign\\(\\s*' + n + '\\b').test(NOC)
    || new RegExp('function\\s+\\w*ProgSet\\([^)]*\\)\\s*\\{[^}]*' + n + '\\s*[,)]').test(NOC);
  if (w <= 1 && !viaHelper) console.log('   ❌ ' + n + ' 只有 ' + w + ' 处写入');
}
console.log('\n════ 扫描结束 ════');
