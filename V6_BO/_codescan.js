// 把 JS 源码里的注释、字符串字面量、正则字面量替换成等长空格，
// 供「只扫真实代码」的静态检查使用（比如判断 `A.xxx()` 是不是真的在调用 analysis.js）。
//
// 为什么不能直接用正则：
//   • `em.js` 这种文件名字符串会被 `em\.(\w+)` 当成一次调用 → 幽灵引用
//   • `/* A.xxx */` 、`${backoffGap}` 同理
//   • /['"]/g 这类正则里的引号若当字符串起点，会把后面一大段整吞掉 → 真实代码被涂没了（漏检）
//
// 返回与原串**等长**且**换行位置一致**的字符串，这样报错行号还能对齐。
// opts.keepStrings = true → 只剥注释与正则，**保留字符串内容**。
//   专供「提取 require('./xxx') 依赖」这类要读字符串的场景：
//   默认模式会把 './em' 一起涂掉，依赖图就空了（实测踩过）。
function stripNoise(src, opts) {
  const keepStrings = !!(opts && opts.keepStrings);
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '/') {                 // 行注释
      let j = i + 2;
      while (j < n && src[j] !== '\n' && src[j] !== '\r') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {                 // 块注释
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n)); i = Math.min(j + 2, n); continue;
    }
    if (c === '/' && d !== '/' && d !== '*') {    // 可能是正则字面量（除法会走到下面）
      let k = i - 1;
      while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
      const prev = k >= 0 ? src[k] : '';
      const looksLikeRegex = prev === '' || '=(,:[!&|?{};+'.indexOf(prev) >= 0
        || /\breturn$/.test(src.slice(Math.max(0, k - 6), k + 1)).valueOf();
      if (looksLikeRegex) {
        let j = i + 1, inCls = false;
        while (j < n && src[j] !== '\n' && src[j] !== '\r') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inCls = true;
          else if (src[j] === ']') inCls = false;
          else if (src[j] === '/' && !inCls) { j++; break; }
          j++;
        }
        blank(i, j); i = j; continue;
      }
    }
    if (!keepStrings && (c === '"' || c === "'" || c === '`')) {    // 字符串 / 模板串
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (q === '`' && src[j] === '$' && src[j + 1] === '{') {   // 模板里的 ${} 是真代码，不涂
          let depth = 1; j += 2;
          while (j < n && depth > 0) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
          }
          continue;
        }
        if (src[j] === '\n' && q !== '`') break;  // 非模板串不能跨行（源码残缺时的自保）
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

module.exports = { stripNoise };
