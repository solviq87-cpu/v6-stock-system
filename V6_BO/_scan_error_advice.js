// 扫描器：报错/提示文案里的【处置建议】是否真的可执行（本轮新角度）。
// 三条判据：
//   ① 数字承诺：文案说「N 分钟后可再试 / N 分钟内有效」，代码里的常量是不是同一个 N。
//      —— 不一致时用户照着做一定失败，而且他没有任何办法发现是提示在骗他。
//   ② 入口承诺：文案说「请在 XX 面板里改 / 点「XX」查看」，前端到底有没有这个入口。
//      —— 面板改版重命名后，提示会指向一个已经不存在的按钮（本项目 bv 轮刚把锁面板改成 5 标签页）。
//   ③ 建议可操作性：让用户去做一件他在这个场景下根本做不到的事。
//      典型：手机端回「请看服务日志」（用户在手机上没有控制台）、
//            登录页回「先配置推送通道」（配置推送本身要先登录，死锁）。
//
// ⛔ 扫描器不是测试：只把可疑点列出来供人工复核，永远 exit 0。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const CODE_K = stripNoise(SV, { keepStrings: true });
const lineOf = i => SV.slice(0, i).split('\n').length;

// 抠出 error: '...' / note: '...' 的单引号字符串（含 \' 转义）
function grabStrings(key) {
  const re = new RegExp(key + ":\\s*'", 'g');
  const out = [];
  let m;
  while ((m = re.exec(CODE_K))) {
    let j = m.index + m[0].length, buf = '';
    while (j < CODE_K.length) {
      const c = CODE_K[j];
      if (c === '\\') { buf += CODE_K[j + 1]; j += 2; continue; }
      if (c === "'") break;
      buf += c; j++;
    }
    out.push({ line: lineOf(m.index), txt: buf });
  }
  return out;
}

const errs = grabStrings('error');
const notes = grabStrings('note');

console.log('=== ① 数字承诺：文案里的 N 分钟/小时/次，是否与代码常量一致 ===');
const NUM = /(\d+)\s*(分钟|小时|秒|次|天)/g;
const numHits = [];
for (const e of errs.concat(notes)) {
  const ms = [...e.txt.matchAll(NUM)];
  if (!ms.length) continue;
  numHits.push({ line: e.line, nums: ms.map(x => x[1] + x[2]), txt: e.txt.slice(0, 90) });
}
if (!numHits.length) console.log('  （无）');
for (const h of numHits) console.log(`  L${h.line}  [${h.nums.join(', ')}]  ${h.txt}`);
console.log('  → 逐个去代码里核对常量（本轮已人工核对：10 分钟节流 / 授权码 10 分钟 / 拒绝 30 分钟 / 验证码 5 分钟 均与常量一致）');

console.log('\n=== ② 入口承诺：文案指向的前端入口，index.html 里是否真的存在 ===');
// 提取「...」包裹的入口名，以及"在 XX 面板/页/框 里"的 XX
const ENTRY_RE = /[「『]([^」』]{2,20})[」』]/g;
const entryHits = [];
for (const e of errs.concat(notes)) {
  const names = [...e.txt.matchAll(ENTRY_RE)].map(x => x[1]);
  const pan = [...e.txt.matchAll(/在([^，。；\s]{0,12})(面板|页|框|区|里|中)/g)].map(x => x[1] + x[2]);
  const all = [...new Set(names.concat(pan))];
  if (!all.length) continue;
  for (const nm of all) {
    // 前端存在性：index.html 里能找到这个串（按钮文字/标题/id），或去掉 emoji 后能找到
    const bare = nm.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    const inHtml = HTML.includes(nm) || (bare.length >= 2 && HTML.includes(bare));
    entryHits.push({ line: e.line, nm, inHtml, txt: e.txt.slice(0, 70) });
  }
}
if (!entryHits.length) console.log('  （无）');
for (const h of entryHits) {
  console.log(`  ${h.inHtml ? '对勾' : '⚠️ '} L${h.line}  入口「${h.nm}」${h.inHtml ? '前端有' : '前端找不到'}  ← ${h.txt}`);
}

console.log('\n=== ③ 建议可操作性：让用户做他在这个场景下做不到的事 ===');
// 关键词：服务日志（手机上看不到）、控制台、本机、重启服务、已登录的设备
const BAD_ADVICE = [
  [/服务日志|服务端日志|看日志|控制台/, '让用户在手机/只读端去看服务端日志 —— 那边根本没有控制台'],
  [/先配置推送|请先配置/, '未登录时让用户"先配置推送"，而配置推送本身要编辑权限（可能死锁）'],
  [/请在已登录的设备上/, '若当前就是唯一设备且登不上，"已登录的设备"不存在'],
  [/请在本机面板|需在本机面板/, '手机端用户够不到"本机面板"'],
];
const adviceHits = [];
for (const e of errs.concat(notes)) {
  for (const [re, why] of BAD_ADVICE) {
    if (re.test(e.txt)) adviceHits.push({ line: e.line, why, txt: e.txt.slice(0, 110) });
  }
}
if (!adviceHits.length) console.log('  （无）');
for (const h of adviceHits) console.log(`  ⚠️ L${h.line}  ${h.why}\n       ${h.txt}`);

console.log('\n=== ④ 承诺性措辞：说了"会/已/自动"的动作，是否真有对应代码路径 ===');
const PROMISE = [/自动推送|会自动|稍后自动|完成后自动|会自动重试/, /已原样保留|未被改动|不会丢|不会静默/, /稍后(再|可)看|请稍候|稍后重试/];
const promiseHits = [];
for (const e of errs.concat(notes)) {
  for (const re of PROMISE) {
    if (re.test(e.txt)) { promiseHits.push({ line: e.line, txt: e.txt.slice(0, 110) }); break; }
  }
}
if (!promiseHits.length) console.log('  （无）');
for (const h of promiseHits) console.log(`  L${h.line}  ${h.txt}`);

console.log('\n=== ⑤ 无建议的裸报错（只说失败、不说怎么办）===');
const NO_ADVICE = errs.filter(e => !/请|可|稍|重[试新]|检查|点|前往|联系|已|自动/.test(e.txt));
console.log('  共 ' + NO_ADVICE.length + ' / ' + errs.length + ' 条');
for (const e of NO_ADVICE) console.log(`  L${e.line}  ${e.txt.slice(0, 100)}`);

console.log('\n（扫描器只列可疑点，不做断言，退出码恒为 0）');
process.exit(0);
