// 守门测试：口令明文绝不能出现在任何会被检索/同步/备份的地方。
// 2026-10-05 事故：我把开发者口令明文写进了 `恢复与备份说明.md`，
// 用户做「语义检索」时被**直接检索出来显示**了 —— 文档是全文可检索的，口令放进去等于公开。
// 之后又发现历史笔记（.workbuddy/memory/*.md）里也散落着明文，一并纳入扫描。
//
// 设计要点：测试里**不硬编码口令**，而是运行时从 `_publish.py` 的 DEV_PWD 读出来再比对，
// 否则这个测试本身就成了一份新的明文副本（那就讽刺了）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// 1) 取出当前口令（从本地发版脚本读；该文件已被 .gitignore 排除，不入库）
let pwd = '';
try {
  const src = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');
  const m = src.match(/DEV_PWD\s*=\s*"([^"]+)"/);
  pwd = m ? m[1] : '';
} catch (e) { /* 全新克隆没有该文件，跳过 */ }

if (!pwd) {
  console.log('ℹ️ 读不到 DEV_PWD（全新克隆环境），跳过明文扫描');
  console.log('\n口令明文守门：0 通过 / 0 失败（跳过）');
  process.exit(0);
}

// 2) 收集所有 .md（根目录 + .workbuddy/memory 递归）
const mdFiles = [];
function walk(dir, depth) {
  if (depth > 4) return;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (!/^(node_modules|\.git|_old_zips|_restored|\.srcpkg)$/.test(it.name)) walk(p, depth + 1);
    } else if (/\.md$/i.test(it.name)) {
      mdFiles.push(p);
    }
  }
}
walk(ROOT, 0);

const hits = mdFiles.filter(f => {
  try { return fs.readFileSync(f, 'utf8').includes(pwd); } catch (e) { return false; }
});

ok('共扫描 ' + mdFiles.length + ' 个 .md，其中 **0 个**含开发者口令明文'.replace(/\*\*/g, ''),
  hits.length === 0);
if (hits.length) hits.forEach(f => console.log('   ↳ 命中：' + path.relative(ROOT, f)));

// 3) 单独钉死那两份恢复文档
const restoreDoc = path.join(ROOT, '恢复与备份说明.md');
if (fs.existsSync(restoreDoc)) {
  const t = fs.readFileSync(restoreDoc, 'utf8');
  ok('恢复与备份说明.md 不含口令明文', !t.includes(pwd));
  ok('恢复与备份说明.md 明确写了「口令不写在这份文件里」', /口令不写在这份文件里/.test(t));
}
const safeDoc = path.join(ROOT, 'RESTORE.md');
if (fs.existsSync(safeDoc)) {
  ok('RESTORE.md（会进仓库）不含口令明文', !fs.readFileSync(safeDoc, 'utf8').includes(pwd));
}

// 4) 反向确认：明文确实还在发版脚本里（那是无人值守发版需要的唯一副本），
//    且该脚本被 .gitignore 拦着 —— 若哪天它进了仓库，这条会绿不了。
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
ok('_publish.py 被 .gitignore 排除（口令不入库）', /^_publish\.py$/m.test(gi));
ok('_post_publish.py 被 .gitignore 排除', /^_post_publish\.py$/m.test(gi));
ok('_publish.py 确实持有 DEV_PWD（无人值守发版需要）', pwd.length >= 4);

console.log('\n口令明文守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
