// 守门：设备台账清理 + view 设备防重复（hz 轮）
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.log('FAIL:', msg); } }

// ① issueDevice 中 view 设备同 fp 去重（已有 go 轮逻辑）
ok(/const bag = role === 'view' \? \(accessSecret\.view = accessSecret\.view \|\| \{\}\) : accessSecret;/.test(SV),
  '① issueDevice bag 按 role 分 view/edit');
ok(/if \(v && v\.fp === fp\)/.test(SV), '② 同 fp 去重逻辑存在');
// ⛔ #291：同 fp 重签的 revoked 词条现在还带 graceUntil（24 小时宽限，旧标签页不当场掉线）。
//    断言钉语义（写了 revoked + 带宽限 + 宽限是常量 DEVICE_GRACE_MS），不钉死 reason 整句文案。
ok(/if \(!_rev\[k\]\) _rev\[k\] = .*reason: '同一设备\(fp\)重新签发.*graceUntil: Date\.now\(\) \+ DEVICE_GRACE_MS/.test(SV),
  '③ 去重时写 revoked（带宽限）');

// ② hz 轮新增：有 fp 设备登录后清除同 role 下无 fp 的 restored 占位
ok(/有fp设备登录后清除旧占位/.test(SV), '④ 无 fp 占位清理注释存在');
ok(/if \(v && v\.restored && !v\.fp\)/.test(SV), '⑤ 无 fp restored 占位清理逻辑存在');

// ③ touchDevice 中 view 设备也按 (ip,role) 去重（go 轮已有）
ok(/touchDevice\(t, role, ip\)/.test(SV), '⑥ touchDevice 签名存在');
ok(/const bag = role === 'view' \? \(viewStore\(\) && viewStore\(\)\.devices\) : \(accessSecret && accessSecret\.devices\);/.test(SV),
  '⑦ touchDevice bag 按 role 分 view/edit');
ok(/if \(v2 && v2\.restored && !v2\.fp && \(v2\.ip \|\| ''\) === \(ip \|\| ''\) && \(v2\.role \|\| role\) === role\)/.test(SV),
  '⑧ touchDevice (ip,role) 去重逻辑存在');

// ④ access.json 清理结果验证（动态）⛔ 活数据不钉死数（hv+1 轮教训 11）
const acc = JSON.parse(fs.readFileSync('access.json', 'utf8'));
const devs = acc.devices || {};
const editN = Object.keys(devs).length;
const viewN = Object.keys((acc.view && acc.view.devices) || {}).length;
const hasRestoredNofp = Object.values(devs).some(v => v && v.restored && !v.fp);
const tempCount = Object.values(devs).filter(v => v && /^verify|hp-route-probe|kline-verify|发布校验/.test(v.name || '')).length;
ok(!hasRestoredNofp, `⑨ 无 restored 无 fp 占位（当前 edit ${editN} 条）`);
ok(tempCount <= 4, `⑩ 临时设备 ≤4 条（实际 ${tempCount}）`);

// ⑤ view 设备无重复 fp
const viewDevs = (acc.view && acc.view.devices) || {};
const viewFps = {};
let dupFp = false;
for (const k of Object.keys(viewDevs)) {
  const fp = viewDevs[k].fp;
  if (fp) { if (viewFps[fp]) dupFp = true; viewFps[fp] = true; }
}
ok(!dupFp, '⑪ view 设备无重复 fp');

// ⑥ revoked 名单由清理/去重写入（⛔ 不钉死数量：revoked 是活数据，随设备台账自然增减，
//   见 hv+1 轮教训11「运行时会长的字段一律不许 === 具体数 / 钉死阈值」。
//   此处只验证该字段被持续维护为对象（写入逻辑由 ③ 的 _rev 正则担保），数量不钉死具体值，
//   否则换一份干净的 access.json（revoked=0）就假红，误导"是否引入回归"的判断。
ok(acc.revoked === undefined || (acc.revoked && typeof acc.revoked === 'object'),
  `⑫ revoked 名单字段被维护（为对象，数量随台账自然增减，不钉死具体值；实际 ${(acc.revoked && Object.keys(acc.revoked).length) || 0}）`);

// ⑦ 启动时自动清理 compactDeviceRegistry 存在且挂到启动链
ok(/function compactDeviceRegistry\(\)/.test(SV), '⑬ compactDeviceRegistry 函数存在');
ok(/compactDeviceRegistry\(\); .*hz 轮：启动时自动清理/.test(SV), '⑭ 启动链调用 compactDeviceRegistry');
ok(/const SYSTEM_FP = new Set\(\['FPUBLISH01'/.test(SV), '⑮ SYSTEM_FP 白名单存在');
ok(/function cleanBag\(bag, role\)/.test(SV), '⑯ cleanBag 辅助函数存在');
ok(/isTemp && !isSystem/.test(SV), '⑰ 临时设备清理逻辑存在');
ok(/byFp\[v\.fp\] !== k/.test(SV), '⑱ 同 fp 去重逻辑存在');

console.log(`${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
