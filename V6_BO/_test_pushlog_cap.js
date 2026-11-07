// ic 轮守门：pushlog 跨回收耐久化（cap 500→1500 + durable 全量镜像 + 超期清理）
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('FAIL:', m); } }

// ① cap 提升
ok(/pushLog:\s*1500/.test(SV), '① DATA_CAP.pushLog 提升到 1500');
// ② mirrorDurable 不裁容量（保存全量）
ok(/JSON\.stringify\(PUSH_LOG\)\)/.test(SV), '② mirrorDurable 保存全量 PUSH_LOG（不裁容量）');
// ③ purge 函数存在
ok(/function purgePushLogOlderThan\(days\)/.test(SV), '③ purgePushLogOlderThan 函数存在');
// ④ 启动链挂载
ok(/purgePushLogOlderThan\(14\)/.test(SV), '④ 启动链挂载 14 天清理');
// ⑤ 清理逻辑：cutoff = now - days*86400000
ok(/Date\.now\(\)[\s\S]{0,40}-[\s\S]{0,40}86400000/.test(SV), '⑤ 清理按 cutoff = now - days*86400000');
// ⑥ pushLogFlush 仍按 cap 裁（运行时收敛口径不变）
ok(/PUSH_LOG\.slice\(0, dataCapOf\('pushLog'\)\)/.test(SV), '⑥ pushLogFlush 仍按 cap 裁（运行时口径不变）');

console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
