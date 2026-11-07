// 守门测试：落盘失败不许静默（2026-10-06 体检修的 5 处「空 catch 包写操作」）
// 空 catch 未必是错（try{ fs.unlinkSync(tmp) }catch{} 这类"尽力而为"很正常），
// 但被吞掉的如果是**落盘 / 持仓同步**，失败就等于数据真的没了，而且谁都看不出来：
//   · savePaper   → 模拟盘的成交与持仓只在这里落盘，写失败 = 重启后整段交易蒸发
//   · saveAccess  → 授权设备台账，写失败 = 撤销过的设备可能"复活"
//   · saveLearn   → 信号样本库，写失败 = 学习成果与命中率统计回退
//   · HD.addRemoteItem → 线上→本地持仓补录，写失败 = 手机加了票、电脑上没有，且无任何提示
//   · 板块流兜底重拉 → 失败 = 板块栏与补涨龙整段无源
// 前四条是「数据层静默失败」，统一钉死：这三类 save 不得出现在空 catch 里。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('\n=== 落盘静默失败守门 ===\n');

// 复用扫描逻辑：找出「空 catch + try 块里有关键落盘调用」
const KEY_SAVE = /\b(savePaper|saveAccess|saveLearn)\s*\(/;
function findSilentSave(code) {
  const hits = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = re.exec(code))) {
    const ti = code.slice(0, m.index).lastIndexOf('try');
    if (ti < 0) continue;
    const bi = code.indexOf('{', ti);
    if (bi < 0) continue;
    let d = 0, j = bi, end = -1;
    for (; j < m.index; j++) {
      if (code[j] === '{') d++;
      else if (code[j] === '}') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) end = m.index;
    const block = code.slice(bi + 1, end);
    if (KEY_SAVE.test(block)) hits.push({ at: ti, block: block.trim().slice(0, 80) });
  }
  return hits;
}
const code = stripNoise(src);
const silent = findSilentSave(code);

console.log('【① 通用闸门：关键落盘不得被空 catch 吞掉】');
ok('全项目无「空 catch 包 savePaper / saveAccess / saveLearn」（实测 ' + silent.length + ' 处）',
  silent.length === 0, JSON.stringify(silent.slice(0, 3)));

// 反证：扫描器本身得真能抓到（否则上面那条永远是假绿）
// ⚠️ 样例里 try 块必须真的出现 savePaper() 调用：光函数名叫 savePaper 不算
//    （第一版就是这么写的，try 里只有 atomicWrite → 检出 0，反证自己先红了）。
const fake = 'function tick(){ try { doSomething(); savePaper(); } catch {} }\n';
const fakeHits = findSilentSave(stripNoise(fake));
ok('反证：扫描器对 `try{…savePaper…}catch{}` 能检出 1 处（不是假绿）', fakeHits.length === 1, '检出 ' + fakeHits.length);
const fakeOk = 'function savePaper(){ try { atomicWrite(F, JSON.stringify(out)); } catch (e) { console.error(e); } }\n';
ok('反证：catch 里补了日志就不再算命中', findSilentSave(stripNoise(fakeOk)).length === 0);

console.log('\n【② 五处关键点的 catch 必须留痕】');
// 抓某个函数/块的完整源码（花括号配平）
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) return '';
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
const hasLoggedCatch = s => /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,400}?console\.error/.test(s);

const fnSavePaper = grab(/^function savePaper\(\) \{/m);
ok('savePaper 的 catch 打日志（模拟盘成交/持仓的唯一落盘口）',
  /function savePaper/.test(fnSavePaper) && hasLoggedCatch(fnSavePaper));

const fnTouch = grab(/^function touchDevice\(/m);
ok('touchDevice 的 catch 打日志（设备台账自动恢复的唯一落盘口）',
  /function touchDevice/.test(fnTouch) && hasLoggedCatch(fnTouch));

ok('HD.addRemoteItem 补录失败逐条打日志', /catch \(e\) \{ addFail\+\+; console\.error/.test(src));
ok('补录失败会汇总告警（_syncLog）', /if \(addFail\) _syncLog\('pull'/.test(src));

// 板块流兜底重拉：定位那次 _writeSectors(S.sectors) 后面的 catch
// ⛔ if 轮换定位串（钉语义不钉字符串）：sectors.json 写入收进 _writeSectors 助手
//    （包装 {at, day, rows, ind}，记数据时刻），三处分支共用；兜底重拉这一处是
//    _writeSectors(S.sectors) 唯一出现位置，语义仍是「catch 打日志」不变。
const secIdx = src.indexOf("_writeSectors(S.sectors)");
const secTail = secIdx > 0 ? src.slice(secIdx, secIdx + 400) : '';
ok('板块流兜底重拉的 catch 打日志（板块栏/补涨龙唯一兜底）',
  secIdx > 0 && /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,400}?console\.error/.test(secTail));

// 非交易日样本迁移
const migIdx = src.indexOf("[learn] 已标废 ' + _v + ' 条非交易日样本");
const migTail = migIdx > 0 ? src.slice(migIdx, migIdx + 600) : '';
ok('非交易日样本迁移的 catch 打日志（周末样本会污染命中率）',
  migIdx > 0 && /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,400}?console\.error/.test(migTail));

console.log('\n【③ 不影响正常路径：这些日志只在 catch 里，不干扰主流程】');
ok('savePaper 主流程仍是 atomicWrite 一次调用，并把成败返回给调用方',
  /atomicWrite\(PAPER_FILE, JSON\.stringify\(out\)\)/.test(fnSavePaper) && /return atomicWrite\(PAPER_FILE/.test(fnSavePaper));
ok('补录成功计数逻辑没被改动（added 仍按返回值递增）', /if \(HD\.addRemoteItem\(it\)\) added\+\+;/.test(src));

console.log('\n落盘静默失败守门：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
