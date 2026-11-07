// 守门测试：回归总榜不许说谎（2026-10-07，本轮「不看代码看事实」查出来的最严重的一处）
//
// 事情是这样的：加了 21 条断言，全量回归的总断言数反而从 2921 掉到 2892。
// 顺着这条线查下去，发现**总榜的绿灯是假的**：
//
//   ① _runall.js 找不到「N 通过 / M 失败」汇总行时，退化成数 ✓ / ✗ 的行数；
//      而套件只要打出过几个 ✓，就**永远不会标红** —— 哪怕它中途崩了。
//      实测两个套件是真崩（exit 1）：
//        · _test_src_priv_channel.js —— 7 个 ✓ 之后 ReferenceError: pushedToday is not defined
//          （沙箱 new Function 的注入清单没跟上：块里新增了 pushedToday 判据）
//        · _test_enum_gap.js —— 14 个 ✓ 之后 ReferenceError: savePushGov is not defined
//          （bt 轮给 modDayTake 加落盘时引入，从那天起这个门就没跑完过）
//      它们崩了以后在总榜上一直是绿的，唯一的痕迹是"总断言数少了一截"。
//
//   ② 另有 11 个套件用 ✅ 或「合计 60 项：通过 60、失败 0」「通过 8 项，失败 0 项」
//      「通过 20 / 20」这类中文写法，旧正则一个都不认 → 按 0 断言计，同样不红。
//
// 换句话说：**过去好几轮"回归 2921/0 全绿"这个结论里，有一部分是凭空的。**
// 这不是某个功能模块的 bug，是"我们用来判断有没有 bug 的那把尺子"本身是漏的 ——
// 而且它的失效方式恰好是最坏的那种：不报错、不崩，只是静静地少报。
//
// 现在三条硬口径：① 退出码非 0 一律标红（崩了就是崩了，没有"部分通过"）
//                 ② 汇总行认四种中文写法  ③ 既没汇总行也没有任何标记 → 计红（套件压根没跑起来）
// 判定逻辑抽成 judge(out, err) 导出，本测试拿真实行为做断言，并全部配旧口径反证。
const path = require('path');
const fs = require('fs');
const ROOT = __dirname;
const { judge } = require('./_runall.js');
const RA = fs.readFileSync(path.join(ROOT, '_runall.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

group('[1] 崩掉不许判绿（本轮最要命的一条）');
{
  // 真实形态：打出 7 个 ✅ 之后 ReferenceError 崩掉，exit 1
  const out = ['✅ a', '✅ b', '✅ c', '✅ d', '✅ e', '✅ f', '✅ g'].join('\n')
    + '\nReferenceError: pushedToday is not defined';
  const r = judge(out, { code: 1 });
  ok('⛔ 打过标记 + 非 0 退出码 → 必须标红', r.fail > 0, 'fail=' + r.fail);
  ok('崩溃标记被如实带出', r.crashed === true);
  // 旧口径：只数标记，不看退出码 → 同一个输入判成"7 通过 0 失败"
  const oks = (out.match(/^\s*(?:✓|✅|对勾)/gm) || []).length;
  const ngs = (out.match(/^\s*(?:✗|❌)/gm) || []).length;
  ok('反证：旧口径（只数标记）会把同一个崩掉的套件判成通过', ngs === 0 && oks === 7,
    `旧口径 fail=${ngs}（应为 0，正是它漏掉的原因）`);
  // 被信号杀掉（超时）同样要红
  const r2 = judge('✅ x\n✅ y', { signal: 'SIGTERM' });
  ok('⛔ 被超时信号杀掉也算崩（不能因为打过标记就放过）', r2.fail > 0 && r2.crashed === true);
  // 反过来：退出码 0 且有失败断言 → 正常标红
  const r3 = judge('10 通过 / 2 失败', null);
  ok('正常失败照旧标红（没把新口径写成一律放过）', r3.fail === 2 && r3.pass === 10);
}

group('[2] 四种汇总写法都得认得（否则按 0 断言计）');
{
  const cases = [
    ['3 通过 / 0 失败', 3, 0, '标准'],
    ['合计 60 项：通过 60、失败 0', 60, 0, '中文（合计 N 项）'],
    ['通过 8 项，失败 0 项', 8, 0, '中文（N 项，）'],
    ['通过 20 / 20', 20, 0, '只给总数'],
    ['结果：45 通过 / 3 失败', 45, 3, '带前缀的标准写法'],
  ];
  for (const [txt, p, f, label] of cases) {
    const r = judge(txt, null);
    ok(`${label} → ${p} 通过 / ${f} 失败`, r.pass === p && r.fail === f, `实得 ${r.pass}/${r.fail}`);
  }
  // 只给总数时，失败数要能从分母算出来
  const r = judge('通过 18 / 20', null);
  ok('⛔「通过 18 / 20」要算出失败 2 条（分母是总数不是失败数）', r.fail === 2 && r.pass === 18, `实得 ${r.pass}/${r.fail}`);
}

group('[3] 标记口径：三种勾都得数得出来');
{
  ok('✅ 计入通过', judge('✅ a\n✅ b', null).pass === 2);
  ok('✓ 计入通过', judge('✓ a', null).pass === 1);
  ok('对勾 计入通过（本项目不少套件用中文）', judge('对勾 a\n对勾 b', null).pass === 2);
  ok('❌ 计入失败', judge('✅ a\n❌ b', null).fail === 1);
  ok('✗ 计入失败', judge('✓ a\n✗ b', null).fail === 1);
  // 缩进的标记行也要认
  ok('缩进的标记行照样认（很多套件输出带两格缩进）', judge('  ✅ a\n  ✅ b', null).pass === 2);
}

group('[4] 压根没跑起来的套件不许算过');
{
  const r = judge('', null);
  ok('⛔ 零输出 + 退出码 0 → 计红（套件没跑起来）', r.fail > 0);
  const r2 = judge('正在启动…', null);
  ok('⛔ 有输出但一个断言都没有 → 也计红', r2.fail > 0);
}

group('[5] 源码层面钉死这三条口径（防止以后被改回去）');
{
  ok('⛔ 退出码压过标记的写法在源码里', /if \(crashed && fail === 0\) fail = 1;/.test(RA));
  ok('⛔ 零断言计红的写法在源码里', /if \(!crashed && pass === 0 && fail === 0\) fail = 1;/.test(RA));
  ok('判定逻辑导出可测（module.exports = { judge }）', /module\.exports = \{ judge \}/.test(RA));
  ok('只在直接运行时才跑全量（被 require 时不许自己跑起来）', /if \(require\.main === module\) next\(\);/.test(RA));
  ok('认 ✅ / 对勾 两种中文标记', /✓\|✅\|对勾/.test(RA));
  ok('认 ✗ / ❌ 两种失败标记', /✗\|❌/.test(RA));
  ok('总榜有红灯时进程退出码非 0（CI 与脚本能拦得住）', /process\.exitCode = red\.length \? 1 : 0;/.test(RA));
}

group('[6] 沙箱注入清单漏项这个坑本身（两个套件就是这么崩的）');
{
  // 这两个套件用 new Function 把 server.js 的实现块抠进沙箱跑，
  // 块里每多引用一个外部符号就必须同步补进注入清单，否则不是断言变红而是整套崩掉。
  const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = SV.indexOf('async function srcPkgShip(b64, ver, name) {');
  const block = SV.slice(i, SV.indexOf('// ── 设备令牌「世代号」', i));
  const T = fs.readFileSync(path.join(ROOT, '_test_src_priv_channel.js'), 'utf8');
  const m = T.match(/const fn = new Function\(([\s\S]*?)\n\s*BLOCK \+ '\\nreturn/);
  const inject = m ? m[1] : '';
  // 块里引用到的顶层符号，逐个看有没有被注入（只查已知注入清单里那批外加 pushedToday）
  for (const sym of ['pushedToday', 'privReady', 'feishuProbe', 'feishuSecId', 'feishuSecMask', 'pushLog']) {
    const used = new RegExp('\\b' + sym + '\\s*\\(').test(block);
    if (!used) continue;
    ok(`⛔ srcPkgShip 用到 ${sym} → 沙箱注入清单里必须有`, new RegExp("'" + sym + "'").test(inject));
  }
  const E = fs.readFileSync(path.join(ROOT, '_test_enum_gap.js'), 'utf8');
  ok('⛔ enum_gap 的 modDayTake 沙箱注入了 savePushGov', /'todayStr', 'savePushGov'/.test(E));
  ok('⛔ 并且断言了「占额度必须落盘」这一条（补回崩掉后缺失的那一组）', /占额度后立刻落盘 savePushGov/.test(E));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
