// 体检扫描器（2026-10-06）：「数值安全 + 比较器 + 吞异常」三类静默缺陷
//  ① 除法右侧不是非零字面量 → 分母可能为 0/未定义 → 面板显示 Infinity / NaN
//  ② .sort() 比较器返回布尔（写成 a.x > b.x）→ 布尔被转成 0/1，排序等于没排（经典静默 bug）
//  ③ 空 catch（catch {} / catch(e){}）→ 异常被整个吞掉，故障 100% 无法自查
//  ④ parseInt 不带基数 → "08" 这类前导零字符串在老引擎被当八进制
//  ⑤ Math.max()/Math.min() 无参 → 返回 -Infinity / Infinity
// 只读不写，输出待人工复核清单。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['server.js', 'analysis.js', 'holdings.js', 'logic.js', 'learnall.js', 'ztpre.js', 'news.js', 'em.js']
    .filter(f => fs.existsSync(path.join(__dirname, f)));

let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const code = stripNoise(raw);            // 注释/字符串/正则已涂成空格，行号仍对齐
  const lines = raw.split('\n');
  const out = [];
  const at = i => code.slice(0, i).split('\n').length;

  // ---------- ① 除法 ----------
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c !== '/' || code[i + 1] === '/' || code[i + 1] === '*') continue;
    // 取右操作数（跳过一元 +/- 与空白与左括号）
    let j = i + 1, rhs = '';
    while (j < code.length && /[\s(+-]/.test(code[j])) { rhs += code[j]; j++; }
    while (j < code.length && /[\w.$]/.test(code[j])) { rhs += code[j]; j++; }
    const core = rhs.replace(/[\s()+-]/g, '');
    if (!core) continue;
    if (/^\d+(\.\d+)?$/.test(core) && +core !== 0) continue;            // 字面量且非 0 = 安全
    if (/^(1e[0-9]+|100|1000|60|24|3600|1e4|1e8)$/i.test(core)) continue;
    const ln = at(i);
    out.push({ ln, kind: '①除零风险', txt: lines[ln - 1].trim().slice(0, 120), rhs: core });
  }

  // ---------- ② sort 比较器返回布尔 ----------
  const sortRe = /\.sort\s*\(/g;
  let m;
  while ((m = sortRe.exec(code))) {
    let d = 0, j = m.index + m[0].length - 1, started = false, end = -1;
    for (; j < code.length; j++) {
      if (code[j] === '(') { d++; started = true; }
      else if (code[j] === ')') { d--; if (started && d === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const cmp = code.slice(m.index, end + 1);
    // 抓箭头函数体 / return 表达式
    const arrow = code.slice(end + 1, Math.min(code.length, end + 200));
    const body = (cmp + ' ' + arrow).slice(0, 260);
    if (!/[<>]=?/.test(body)) continue;                 // 没有比较符 → 不是布尔比较器
    if (body.includes('?')) continue;                   // 三元 → 通常是对的（? 1 : -1）
    if (/[;{}\n]/.test(body.slice(0, body.search(/=>/) + 2))) { /* fallthrough */ }
    // 正确的数值比较器几乎必带减号；带比较符却没减号 → 高度可疑
    const seg = body.slice(body.search(/=>/));
    const seg2 = seg.slice(0, Math.max(seg.search(/[;,)]/), 40));
    if (!/-/.test(seg2) && /[<>]/.test(seg2)) {
      out.push({ ln: at(m.index), kind: '②sort比较器返回布尔', txt: lines[at(m.index) - 1].trim().slice(0, 160) });
    }
  }

  // ---------- ③ 空 catch ----------
  const catchRe = /catch\s*(?:\([^)]*\))?\s*\{[\s]*\}/g;
  while ((m = catchRe.exec(code))) {
    out.push({ ln: at(m.index), kind: '③空catch吞异常', txt: lines[at(m.index) - 1].trim().slice(0, 140) });
  }

  // ---------- ④ parseInt 无基数 ----------
  const piRe = /parseInt\s*\(/g;
  while ((m = piRe.exec(code))) {
    let d = 0, j = m.index + m[0].length - 1, end = -1;
    for (; j < code.length; j++) {
      if (code[j] === '(') d++;
      else if (code[j] === ')') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const inner = code.slice(m.index + m[0].length, end);
    if (!inner.includes(',')) out.push({ ln: at(m.index), kind: '④parseInt无基数', txt: lines[at(m.index) - 1].trim().slice(0, 140) });
  }

  // ---------- ⑤ Math.max()/min() 无参 ----------
  const mmRe = /Math\.(max|min)\s*\(\s*\)/g;
  while ((m = mmRe.exec(code))) {
    out.push({ ln: at(m.index), kind: '⑤Math.max/min无参', txt: lines[at(m.index) - 1].trim().slice(0, 140) });
  }

  if (out.length) {
    console.log('\n===== ' + f + '（' + out.length + ' 处待复核）=====');
    const byKind = {};
    for (const o of out) (byKind[o.kind] = byKind[o.kind] || []).push(o);
    for (const k of Object.keys(byKind).sort()) {
      console.log('\n-- ' + k + ' ' + byKind[k].length + ' 处 --');
      const seen = new Set();
      for (const o of byKind[k]) {
        if (seen.has(o.ln)) continue; seen.add(o.ln);
        console.log('  L' + o.ln + (o.rhs ? '  [/' + o.rhs + ']' : '') + '  ' + o.txt);
      }
    }
    total += out.length;
  } else console.log('\n===== ' + f + '：无命中 =====');
}
console.log('\n合计待复核 ' + total + ' 处');
