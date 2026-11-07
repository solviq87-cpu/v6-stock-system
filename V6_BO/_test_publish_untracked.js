// _test_publish_untracked.js
// 守门：发布包未跟踪文件可见化（_publish.warn_untracked）
// 做法：child_process 调 python 真实跑 warn_untracked（mock git ls-files），捕获 stdout，
//       验证「未跟踪源码被列出 / 已跟踪不报 / 数据 json 不误报 / git 不可用静默跳过」。
// 纯单元测试：不依赖真实 git 仓库状态、不调线上，稳定可重复。
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// 用例 1：正常检测——未跟踪源码应报，已跟踪与数据文件不报
const py1 = `
import os, tempfile, io, contextlib, json, subprocess as _sp
import _publish
_orig = _sp.check_output
def fake(cmd, cwd=None, stderr=None):
    assert cmd[:2] == ['git','ls-files'], cmd
    return b'server.js\\npublic/index.html\\n'
_sp.check_output = fake
d = tempfile.mkdtemp()
os.makedirs(os.path.join(d,'public'))
open(os.path.join(d,'server.js'),'w').close()
open(os.path.join(d,'_collect_changes.js'),'w').close()
open(os.path.join(d,'public','index.html'),'w').close()
open(os.path.join(d,'data.json'),'w').close()
open(os.path.join(d,'_foo.py'),'w').close()
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    _publish.warn_untracked(d)
out = buf.getvalue()
_sp.check_output = _orig
print('RESULT ' + json.dumps({
  'untracked_js': '_collect_changes.js' in out,
  'untracked_py': '_foo.py' in out,
  'tracked_server': 'server.js' not in out,
  'tracked_index': 'public/index.html' not in out,
  'data_json_ok': 'data.json' not in out,
  'has_warn': '未跟踪文件提示' in out,
}))
`;
try {
  const o = execFileSync('python', ['-c', py1], { cwd: __dirname, encoding: 'utf-8', timeout: 60000 });
  const l = o.split('\n').find(x => x.startsWith('RESULT '));
  const r = JSON.parse(l.slice(7));
  ok('未跟踪源码 _collect_changes.js 被检出', r.untracked_js);
  ok('未跟踪源码 _foo.py 被检出', r.untracked_py);
  ok('已跟踪 server.js 不报', r.tracked_server);
  ok('已跟踪 public/index.html 不报', r.tracked_index);
  ok('数据 json 不误报', r.data_json_ok);
  ok('未跟踪时打印提示头', r.has_warn);
} catch (e) {
  fail++;
  console.log('  ✗ python 用例1 执行失败: ' + ((e.stderr || e.message) || '').split('\n').slice(-3).join(' | '));
}

// 用例 2：git 不可用 → 静默跳过（不误报、不抛异常）
const py2 = `
import io, contextlib, json, subprocess as _sp, _publish
_orig = _sp.check_output
def fake(*a, **k): raise RuntimeError('no git')
_sp.check_output = fake
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    _publish.warn_untracked('__nonexist_dir__')
out = buf.getvalue()
_sp.check_output = _orig
print('SILENT ' + json.dumps(('untracked' not in out.lower()) and ('异常' not in out) and ('报错' not in out)))
`;
try {
  const o2 = execFileSync('python', ['-c', py2], { cwd: __dirname, encoding: 'utf-8', timeout: 60000 });
  const l2 = o2.split('\n').find(x => x.startsWith('SILENT '));
  ok('git 不可用静默跳过（不误报不抛）', JSON.parse(l2.slice(7)));
} catch (e) {
  fail++;
  console.log('  ✗ python 用例2 执行失败: ' + ((e.stderr || e.message) || '').split('\n').slice(-3).join(' | '));
}

console.log(pass + ' 通过 / ' + fail + ' 失败  _test_publish_untracked.js');
process.exit(fail > 0 ? 1 : 0);
