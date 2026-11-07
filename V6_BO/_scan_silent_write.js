// 体检扫描器（2026-10-06）：找出「空 catch 包着写操作」的静默失败点。
// 空 catch 本身不一定错（try{ fs.unlinkSync(tmp) }catch{} 这类"尽力而为"很正常），
// 但如果被吞掉的是**落盘 / 通知 / 计数器递增 / 状态登记**，那失败就意味着数据真的丢了、
// 而且谁都不知道 —— 这正是「看着在跑、其实没生效」的故障源头。
// 做法：从每个空 catch 往前找最近的 try {，取 try 块源码，看里面有没有写类调用。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['server.js'];
// 写/通知类调用（命中即视为「不该被静默吞掉」）
const WRITE_RE = /\b(atomicWrite|writeFileSync|appendFileSync|savePaper|saveAccess|saveNews|saveCfg|saveState|saveStats|saveLearn|pushAll|pushPaperDigest|pushTo|HD\.commit|HD\.add|HD\.addRemoteItem|HD\.remove|kick|logSignal|noteLearnChange|srcPkgShip|syncUpstream)\s*\(/;
// 明确的"尽力而为"清理动作，不算写业务数据
const CLEANUP_RE = /^\s*(try\s*\{\s*)?(fs\.)?(unlinkSync|rmSync|renameSync|mkdirSync|close|destroy|abort)\s*\(/;

let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const code = stripNoise(raw);
  const lines = raw.split('\n');
  const at = i => code.slice(0, i).split('\n').length;
  const hits = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = re.exec(code))) {
    // 往前找最近的 "try {"（这个 catch 一定紧跟它的 try 块）
    const before = code.slice(0, m.index);
    const ti = before.lastIndexOf('try');
    if (ti < 0) continue;
    // try 块的花括号范围
    let bi = code.indexOf('{', ti);
    if (bi < 0) continue;
    let d = 0, j = bi, end = -1;
    for (; j < m.index; j++) {
      if (code[j] === '{') d++;
      else if (code[j] === '}') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) end = m.index;
    const block = raw.slice(bi + 1, end);
    if (CLEANUP_RE.test(block.trim())) continue;         // 只是删临时文件/关连接 → 正常
    const w = block.match(WRITE_RE);
    if (!w) continue;
    hits.push({ ln: at(ti), fn: w[0].replace(/\s*\($/, ''), txt: raw.slice(bi + 1, end).trim().split('\n')[0].slice(0, 150) });
  }
  console.log('\n===== ' + f + '：' + hits.length + ' 处「空catch包写操作」=====');
  for (const h of hits) {
    console.log('  L' + h.ln + '  [' + h.fn + ']  ' + h.txt);
  }
  total += hits.length;
}
console.log('\n合计 ' + total + ' 处');
