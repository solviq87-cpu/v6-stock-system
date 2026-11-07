// 扫描器（ct 轮 · 角度：系统里那些「默认是对的」的假设）
// 与已有两个扫描器的边界：
//   · _scan_prereq.js          → 函数形参少传导致静默退化（前提没带过去）
//   · _scan_default_semantics.js → 「算不出来」该返回什么（降级值类型不一致）
//   · 本扫描器                → **隐含上下文假设**：默认取第一个、默认已排好序、
//                                默认外部响应就是那个结构、默认"现在"就是想要的时刻。
// 这些假设一旦不成立不报错，只会让结果悄悄偏掉，而且往往藏在层层调用最里面。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });
const lines = NOC.split('\n');

const show = (title, hits, fmt) => {
  console.log('\n【' + title + '】共 ' + hits.length + ' 处');
  hits.slice(0, 14).forEach(h => console.log('  L' + h.line + '  ' + fmt(h)));
  if (hits.length > 14) console.log('  …（余 ' + (hits.length - 14) + ' 处）');
};

console.log('════ 隐含假设扫描：默认取第一个 / 默认有序 / 默认响应结构 ════');

// ① 默认取第一个：把数组首元素当成"那一个"
const first = [];
lines.forEach((l, i) => {
  if (/\[0\]\s*\)|\.find\([^)]*\)\s*[;,)]|\[0\]\./.test(l) || /\b(shift|next\(\)\.value)\b/.test(l)) {
    first.push({ line: i + 1, raw: l.trim().slice(0, 100) });
  }
});
show('① 取首元素当代表（数组为空或顺序变了就 silently 拿错）', first, h => h.raw);

// ② 默认有序：排序后直接 slice 取前 N，但排序键可能不是"质量"
const sorted = [];
lines.forEach((l, i) => {
  if (/\.sort\(/.test(l)) sorted.push({ line: i + 1, raw: l.trim().slice(0, 100) });
});
show('② 排序点（下游 slice(0,N) 默认"前面就是最好的"）', sorted, h => h.raw);

// ③ 默认外部响应结构：不校验就取深层字段
const deep = [];
lines.forEach((l, i) => {
  if (/(\w+)\.data\.\w+\.\w+|(\w+)\.data\.\w+\[0\]|diff\[0\]|\.result\.|json\(\)\.data/.test(l)) {
    deep.push({ line: i + 1, raw: l.trim().slice(0, 100) });
  }
});
show('③ 外部响应直接取深层字段（接口换结构 = 静默 undefined）', deep, h => h.raw);

// ④ 默认"现在"：无参取当前时刻（跨天/休市语义）
const now = [];
lines.forEach((l, i) => {
  if (/new Date\(\)|Date\.now\(\)/.test(l) && !/^\s*\/\//.test(l)) now.push({ line: i + 1, raw: l.trim().slice(0, 90) });
});
console.log('\n【④ 无参取"现在"】共 ' + now.length + ' 处（其中多数合理，重点看跨天/休市语境下的）');

// ⑤ 兜底掩盖假设：|| 0 / || [] 把"没有"变成"有"
const orz = [];
lines.forEach((l, i) => {
  const m = l.match(/\|\|\s*(0|\[\]|\{\}|'')\b/);
  if (m) orz.push({ line: i + 1, raw: l.trim().slice(0, 90), v: m[1] });
});
console.log('\n【⑤ "|| 0 / || []" 把缺失当成默认值】共 ' + orz.length + ' 处（其中 || 0 参与比较会变成"算出来了，值是0"）');

console.log('\n════ 扫描结束 ════');
