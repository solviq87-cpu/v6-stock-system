// 守门：手机端面板样式（im 轮，2026-10-16）
// 钉语义不钉数字：用户 2026-10-16 明确「面板改的看不习惯，改回原本样式」——
//   手机端不再折叠/置顶/吸顶，恢复成原本全部区块直接可见的响应式（≤760px 只调表单/卡片单列，不动 DOM 结构）。
// 防回退：任何把「折叠/置顶/吸顶」 machinery 重新塞回 index.html 的改动都会让这条红。
//   ① 源码里不得再出现 buildSectionBodies / toggleMobileAll 函数定义；
//   ② 不得再出现 #mobileExpandBtn 展开按钮；
//   ③ CSS 不得再引入 .sec-body / .sec-pinned / .mobile-all / .sec-head-fold / .sec-body-fold / .sec-body-first / .sec-body-keep；
//   ④ 不得再有「matchMedia 把竞价提到最前」的 DOM 重排逻辑；
//   ⑤ 真实渲染：9 个 .sec 区块全部直接可见（无包裹）、首屏第 0 个仍是「盘面总览」（in 轮回退到 if 之前最简布局：竞价异动已并回盘面总览，不再有独立「竞价与梯队」区块）。
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (_) {
  ({ JSDOM, VirtualConsole } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom'));
}

const ROOT = __dirname;
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};

// ===== ① 源码不得含折叠/置顶/吸顶函数定义 =====
ok('源码不含 buildSectionBodies 函数定义', !HTML.includes('function buildSectionBodies()'));
ok('源码不含 toggleMobileAll 函数定义', !HTML.includes('function toggleMobileAll()'));

// ===== ② 不得含展开按钮 =====
ok('HTML 不含 #mobileExpandBtn 展开按钮', !HTML.includes('id="mobileExpandBtn"'));

// ===== ③ CSS 不得引入折叠/吸顶类 =====
// 先把所有「//」行内注释剥掉再查类名：版本历史注释（含 const APP_VER 行尾）会用散文回顾旧的折叠实现
//（.sec-head-fold 等字面量），那是历史记录不是活代码，不能让它误判成「还在折叠」。
const JS = HTML.replace(/\/\/.*$/gm, '');
ok('CSS 不含 .sec-body', !/\.sec-body[\s{,.:]/.test(JS));
ok('CSS 不含 .sec-pinned', !JS.includes('.sec-pinned'));
ok('CSS 不含 .mobile-all', !JS.includes('.mobile-all'));
ok('CSS 不含 .sec-head-fold', !JS.includes('.sec-head-fold'));
ok('CSS 不含 .sec-body-fold', !JS.includes('.sec-body-fold'));
ok('CSS 不含 .sec-body-first', !JS.includes('.sec-body-first'));
ok('CSS 不含 .sec-body-keep', !JS.includes('.sec-body-keep'));
ok('CSS 未把 .sec-nav 隐藏（原本吸顶速跳导航保留可见）', !JS.includes('.sec-nav{display:none}'));

// ===== ④ 不得有「matchMedia 把竞价提到最前」的重排逻辑 =====
ok('HTML 不含 matchMedia 手机端置顶重排', !HTML.includes("matchMedia.call(window, '(max-width:760px)')"));

// ===== ⑤ 真实渲染：10 个 .sec 全部直接可见，首屏顺序为原本（盘面总览在前）=====
const vc = new VirtualConsole();
const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { document } = dom.window;
const secAll = document.querySelectorAll('div.sec');
// ⛔ 2026-10-28 改钉：区块数从 9 → 10（新增「🚀 发布看板」一块）。
//    光数数量防不住"新块插到首屏"，所以同时钉顺序：
//    ① 第 0 块必须是盘面总览；② 发布看板（运维面板）必须在最后一块。
ok('共有 10 个 .sec 区块（与 DOM 结构一致）', secAll.length === 10, '实际 ' + secAll.length);
ok('无 .sec-body 包裹（所有区块直接可见，未折叠）', document.querySelectorAll('.sec-body').length === 0);
const firstSec = secAll[0] ? (secAll[0].textContent || '') : '';
ok('首屏第 0 个 .sec 仍是「盘面总览(市场情绪)」（原本顺序，未被抢到竞价前）', firstSec.includes('盘面'), '首屏=' + firstSec.slice(0, 12));
{
  // ⛔ 发布看板是运维操作面板，不是行情 —— 手机首屏推开的必须是盘面，所以它只能排在最后。
  const secTxt = Array.from(secAll).map(s => (s.textContent || ''));
  const idxRel = secTxt.findIndex(t => t.includes('发布看板'));
  ok('发布看板排在最后一个 .sec（不抢首屏）', idxRel > 0 && idxRel === secTxt.length - 1,
    '发布看板@' + idxRel + ' / 共 ' + secTxt.length);
}
const idxAuc = Array.from(secAll).findIndex(s => (s.textContent || '').includes('竞价'));
ok('竞价不再作为独立 .sec 区块（in 轮回退：竞价异动已并回盘面总览，不再有「竞价与梯队」合并区）', idxAuc === -1, '竞价独立 section@' + idxAuc);
ok('竞价异动卡仍在文档中（id=aucSectors，未被删）', !!document.getElementById('aucSectors'));

console.log(`_test_mobile_fold(原样回退): ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
