// 前端异常可见性守门测试（2026-10-06）
// ── 为什么单独立一个套件 ────────────────────────────────────────────────
// public/index.html 里 refresh() 是 650 行渲染，外层只有一个 `catch (e) { console.error(e) }`，
// 而全项目**连 window.onerror 都没有**。后果：任何一处抛错（后端少返回一个字段、
// 某个元素 id 变了、数据里冒出 null）都会被整块吞掉 —— 面板从此停在旧数据，
// 手机上打不开控制台，用户只会以为"今天没行情"。这类故障 100% 静默、无法自查。
// 本套件钉死三件事：① refresh 的 catch 必须把错误显示出来 ② 必须有全局 error 兜底
// ③ 必须有 unhandledrejection 兜底（async 函数 reject 走的是这条路）。
const fs = require('fs');
const path = require('path');
const H = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};

// ① refresh() 外层 catch 不能再只是 console.error
ok('refresh 的 catch 会把错误显示到页面上',
  /\} catch \(e\) \{ console\.error\(e\); showRenderError\(e, '面板渲染'\); \}/.test(H));
ok('不再有「只 console.error 不显示」的裸 catch',
  !/\} catch \(e\) \{ console\.error\(e\); \}\s*\n\s*for \(const \{ el, top \}/.test(H));

// ② 全局兜底
ok('有 window error 兜底', /window\.addEventListener\('error'/.test(H));
ok('有 unhandledrejection 兜底', /window\.addEventListener\('unhandledrejection'/.test(H));
ok('两个兜底都会把错误显示出来', (H.match(/showRenderError\(/g) || []).length >= 3);

// ③ showRenderError 本身必须打不垮页面（它自己内部要有 try）
const fn = (H.match(/function showRenderError\(e, where\) \{[\s\S]*?\n\}/) || [''])[0];
ok('showRenderError 可定位', fn.length > 200);
ok('showRenderError 自带 try（提示组件自己不能抛错）', /function showRenderError[\s\S]{0,120}?try \{/.test(fn));
ok('showRenderError 末尾空 catch（吞掉自身异常）', /\}\s*catch \(_\)\s*\{\s*\}/.test(fn));
ok('错误文案经过 esc 转义（外部文本不能直接拼 innerHTML）', /esc\(msg\)/.test(fn));
ok('提供了重试按钮且点了会移除提示框', /onclick="refresh\(\)[\s\S]{0,120}?remove\(\)/.test(fn));

// ④ 提示框是动态创建的（不能依赖 HTML 里预先存在的元素，否则结构一改就失效）
ok('提示框用 createElement 动态创建', /box = document\.createElement\('div'\);\s*\n\s*box\.id = 'renderErrBox'/.test(fn));

console.log('\n前端异常可见性守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
