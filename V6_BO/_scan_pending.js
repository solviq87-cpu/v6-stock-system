// 扫描器：把"秒回 pending + 后台跑"的承诺全部摊开，逐条看有没有收尾（本轮角度的普查版）。
// 守门测试 _test_pending_promise.js 只钉住已修的那几处，这个负责找还有没有别处中招。
//
// 输出两块：
//   ① pending 路由清单：后台有没有异步任务、失败会不会发声、有没有处理"被忙碌标志挡下"的 running 分支。
//   ② 全项目"失败只进日志"的兜底：`.catch(e => console.error(...))` / `catch (e) { console.error(...) }`
//      —— 比空 catch 好一点（至少有日志），但对用户来说同样是"什么都没发生"。逐条供人工判断：
//      凡是会被用户主动触发的（面板按钮 / 手机指令），失败就该进推送流水或回一条消息。
//
// ⛔ 扫描器不是测试：只列可疑点供人工复核，永远 exit 0。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const CODE_K = stripNoise(SV, { keepStrings: true });
const lineOf = i => SV.slice(0, i).split('\n').length;

console.log('=== ① pending 路由：后台跑重活的，失败有没有发声 ===\n');
{
  const re = /pending:\s*true/g;
  let m; const seen = new Set();
  while ((m = re.exec(CODE_K))) {
    const s = CODE_K.lastIndexOf("if (p === '", m.index);
    if (s < 0 || seen.has(s)) continue;
    seen.add(s);
    const j = CODE_K.indexOf("if (p === '", m.index);
    const route = (SV.slice(s, s + 60).match(/'([\/\w-]+)'/) || ['', '?'])[1];
    const body = SV.slice(s, j > 0 ? j : SV.length);
    const hasAsync = /\)\s*\.then\(|\(async \(\) =>|\.catch\(/.test(body);
    const voice = /pushLog\(|pushWecom\(/.test(body);
    const running = /r\.running|running:/.test(body);
    console.log(`  ${route}  L${lineOf(m.index)}`);
    console.log(`      后台异步: ${hasAsync ? '有' : '无（等待外部事件，靠前端轮询）'}` +
      ` | 失败发声: ${voice ? '有' : (hasAsync ? '⚠️ 无' : '不适用')}` +
      ` | running 分支: ${running ? '有' : (hasAsync ? '·无' : '不适用')}`);
  }
}

console.log('\n=== ② 全项目"失败只进日志"的兜底（用户侧看起来什么都没发生）===\n');
{
  const pats = [
    [/\.catch\(\s*(\w+)\s*=>\s*console\.error\([^\n]*?\)\s*\)/g, '.catch(e => console.error(…))'],
    [/\.catch\(\s*\(\)\s*=>\s*console\.error\([^\n]*?\)\s*\)/g, '.catch(() => console.error(…))'],
  ];
  const hits = [];
  for (const [re, label] of pats) {
    for (const m of CODE_K.matchAll(re)) {
      const i = m.index;
      const fnStart = CODE_K.lastIndexOf('\nfunction ', i);
      const fnName = fnStart > 0 ? (SV.slice(fnStart, fnStart + 80).match(/function\s+(\w+)/) || ['', '(匿名)'])[1] : '(顶层)';
      hits.push({ line: lineOf(i), label, fn: fnName, txt: SV.slice(i, i + 90).replace(/\s+/g, ' ') });
    }
  }
  if (!hits.length) console.log('  对勾 无。');
  else {
    console.log('  共 ' + hits.length + ' 处（逐条判断：会被用户主动触发的，失败就该进推送流水）：\n');
    for (const h of hits) console.log(`  L${h.line}  [${h.label}]  在 ${h.fn}()\n       ${h.txt}`);
  }
}

console.log('\n=== ③ 前端 setInterval 轮询：有没有停表出口 ===\n');
{
  const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const re = /setInterval\(([\s\S]*?)\n/g;
  let n = 0;
  for (const m of HTML.matchAll(/setInterval\(/g)) {
    const i = m.index;
    // 取后面 900 字符看有没有 clearInterval
    const tail = HTML.slice(i, i + 900);
    const hasClear = /clearInterval/.test(tail);
    const line = HTML.slice(0, i).split('\n').length;
    n++;
    if (!hasClear) console.log(`  ⚠️ L${line} setInterval 附近 900 字符内看不到 clearInterval（可能永不停止）`);
  }
  console.log(`  扫描 setInterval 共 ${n} 处${n ? '，未列出即都有停表出口' : ''}`);
}

console.log('\n（扫描器只列可疑点，不做断言，退出码恒为 0）');
process.exit(0);
