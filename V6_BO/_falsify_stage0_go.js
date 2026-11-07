// go 轮守门反证：把「旧写法/漏写法」注入 server.js 临时副本，确认 _test_stage0_go.js 对应断言变红。
// 铁律：守门改动必须跑反证，否则绿可能只是因为断言写了和实现一样的错。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const NODE = 'C:/Users/28957/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const testSrc = fs.readFileSync(path.join(ROOT, '_test_stage0_go.js'), 'utf8');

const CASES = [
  {
    name: 'A1 大单流入漏 private（旧写法）',
    mutate: s => s.replace("modDay: 'bigmoney', private: true });", "modDay: 'bigmoney' });"),
    expect: 'A1 大单流入推送带 private',
  },
  {
    name: 'A10 模拟盘动态退回只 sseEdit（2026-10-06 旧写法）',
    mutate: s => s.replace("{ sseEdit: true, private: true }", "{ sseEdit: true }"),
    expect: 'A10 模拟盘动态 private 与 sseEdit',
  },
  {
    name: 'F3-1 issueDevice 光删台账不写 revoked（旧写法）',
    mutate: s => s.replace("        if (!_rev[k]) _rev[k] = { at: new Date().toLocaleString('zh-CN'), reason: '同一设备(fp)重新签发，旧令牌作废', fp };\n", ''),
    expect: 'F3-1 issueDevice 同 fp 作废旧记录时写 revoked 名单',
  },
  {
    name: 'F3-2 touchDevice 去重加回 ip 非空前提（旧写法）',
    mutate: s => s.replace("for (const k of Object.keys(bag)) {\n        const v2 = bag[k];\n        if (v2 && v2.restored && !v2.fp && (v2.ip || '') === (ip || '')",
                           "if (ip) {\n      for (const k of Object.keys(bag)) {\n        const v2 = bag[k];\n        if (v2 && v2.restored && !v2.fp && v2.ip === ip"),
    expect: 'F3-2 touchDevice 占位去重无 ip 非空前提',
  },
  {
    name: 'B2/B3-3 体检去掉副本闸门（旧写法：副本也体检）',
    mutate: s => s.replace("const _pushHealthTick = async () => {\n    if (isReplica()) return;", "const _pushHealthTick = async () => {"),
    expect: 'B2/B3-3 体检回调有副本闸门',
  },
  {
    name: 'C2-4 条数闸门不减半（旧写法）',
    mutate: s => s.replace("const capTotal = (capTotalRaw > 0 && _cold) ? Math.max(1, Math.floor(capTotalRaw / 2)) : capTotalRaw;", "const capTotal = capTotalRaw;"),
    expect: 'C2-4 条数闸门偏冷减半',
  },
  {
    name: 'C3-3 govTake 不拦跟风（旧写法：只有展示分类）',
    mutate: s => s.replace(/const _follow = \(typeof ztFollowOf === 'function'\) \? ztFollowOf\(code\) : null;\n  if \(_follow === 'follow'\) \{[\s\S]{0,300}?\n  \}\n/, ''),
    expect: 'C3-3 govTake 对跟风涨停返回不可用',
  },
  {
    name: 'D5-1 去掉实测命中率硬闸（旧写法）',
    mutate: s => s.replace("if (!forcePush && _fz.emp != null && _fz.empN >= D5_MIN_N && _fz.emp < D5_MIN_HIT) {", "if (false) {"),
    expect: 'D5-1 实测命中率硬闸',
  },
];

let allOk = true;
for (const c of CASES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-falsify-'));
  const mutated = c.mutate(src);
  if (mutated === src) { console.log('⚠️  ' + c.name + '：变异未生效（没匹配到旧代码），本条跳过'); allOk = false; continue; }
  fs.writeFileSync(path.join(dir, 'server.js'), mutated);
  fs.writeFileSync(path.join(dir, '_test_stage0_go.js'), testSrc);
  let out = '', code = 0;
  try {
    out = execFileSync(NODE, ['_test_stage0_go.js'], { cwd: dir, encoding: 'utf8' });
  } catch (e) { code = e.status || 1; out = (e.stdout || '') + (e.stderr || ''); }
  const targetRed = out.indexOf('❌ ' + c.expect) >= 0;
  const othersRed = (out.match(/❌/g) || []).length;
  console.log((targetRed ? '✅ 反证成立' : '❌ 反证失败') + '：' + c.name +
    ' → 目标断言' + (targetRed ? '已变红' : '仍绿（守门没钉住！）') + '，本条退出码 ' + code + '，共 ' + othersRed + ' 条红');
  if (!targetRed) allOk = false;
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n反证总结：' + (allOk ? '全部成立' : '存在失败项，需检查'));
process.exit(allOk ? 0 : 1);
