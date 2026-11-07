// 把 public/index.html 里的第一段 <script> 抽出来做语法定位。
//
// 存在的理由：浏览器里 "点了没反应" 常常就是这段内联脚本有个括号没闭合，
// 但整份 HTML 有近 3000 行，node --check 又不能直接吃 HTML —— 肉眼找不到行号。
//
// ⚠️ 两处坑都踩过：
//   ① 以前写死 .../versions/22.22.2-3/node.exe，运行时升级到 -5 后路径不存在，
//      排查语法错时这工具先抛 ENOENT 坏了。
//   ② 改成 process.execPath（运行时自己的 node）后，spawn 自身在某些沙箱里直接 EBUSY。
//      → 最终方案：**不 spawn**，用内置 vm.Script 进程内编译，等价于 node --check 的语法检查。
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
const b = blocks[0] || '';

try { fs.writeFileSync('_block.js', b, 'utf8'); } catch {}
try {
  // 套一层函数包装，避免顶层标识符与 vm 脚本作用域产生差异
  new vm.Script('(function(){' + b + '\n})', { filename: 'index.html<script>' });
  console.log('BLOCK_OK  （inline script 语法正常，' + b.split('\n').length + ' 行）');
} catch (e) {
  const msg = String(e.message || e);
  console.log('SYNTAX_ERROR: ' + msg);
  // stack 第一行形如 "index.html<script>:1234"
  const mm = (e.stack || '').match(/index\.html<script>:(\d+)/);
  const ln = mm ? parseInt(mm[1], 10) : 0;
  if (ln) {
    const lines = b.split('\n');
    console.log('出错行 ≈ ' + ln + '（inline script 内的行号）');
    for (let i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 2); i++) {
      console.log('  ' + (i + 1) + (i + 1 === ln ? ' >> ' : ' :  ') + lines[i]);
    }
  }
}
