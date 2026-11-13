#!/usr/bin/env node
/**
 * 守门：推送通道自检必须走私密通道（_test_testpush_private.js，2026-10-28）
 *
 * 背景（用户铁律：所有推送一律私密通道，发群必须显式 {public:true}）：
 *   /api/test-push（面板「推送通道自检」按钮）原先固定走 feishuId()（公开群机器人）+ feishuSecret，
 *   而正常推送早已默认走私密机器人 feishuSecId()。两个后果：
 *     ① 体检的不是实际生效的通道 → 「自检收到了」≠「真推送能收到」，误导排障；
 *     ② 自检本身往公开通道外发 → 违反私密铁律（2026-10-28 01:39 流水 channel='飞书' 即此路径）。
 *
 * 本守门钉死三件事：
 *   A. 私密优先：先取 feishuSecId()，私密没配才退回 feishuId()（并如实标注通道名）；
 *   B. 不再硬编码 channel:'飞书' 与 feishuSecret 直推（旧写法反证：改回去即失守）；
 *   C. 掩码跟着走（私密体检返回私密掩码，不拿公开掩码冒充）。
 *
 * 做法：从 server.js 里按函数名显式 grab 出 /api/test-push 那段代码做源码断言
 *      （不靠"相邻吞到下一个顶层 }"，避免并行改码后误抓）。
 */
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, 'server.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ← ' + extra : '')); }
}

// ── 显式抓取 /api/test-push 段：从 `p === '/api/test-push'` 行起，到该 if 块结束（配对大括号）──────────
function grabBlock(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return '';
  // 回退到行首
  const start = src.lastIndexOf('\n', i) + 1;
  // 从 marker 起向后配对大括号
  let depth = 0, seen = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) { j++; break; } }
  }
  return src.slice(start, j);
}

const block = grabBlock(src, "p === '/api/test-push'");
console.log('\n=== A. 私密优先 ===');
ok('抓到 /api/test-push 代码段', block.length > 200, '长度=' + block.length);
ok('先取私密通道 feishuSecId()', /let\s+_pid\s*=\s*feishuSecId\(\)/.test(block));
ok('私密未配置才退回 feishuId()', /if\s*\(\s*!_pid\s*\)\s*\{[\s\S]*?_pid\s*=\s*feishuId\(\)/.test(block));
ok('私密密钥用 feishuSecSecret', /feishuSecSecret/.test(block));
ok('公开体检优先运行时密钥，兼容配置密钥', /_psec\s*=\s*process\.env\.V6_FEISHU_PUBLIC_SECRET\s*\|\|\s*\(S\.config\s*&&\s*S\.config\.feishuSecret\)/.test(block));

console.log('\n=== B. 旧写法反证（改回去即失守）===');
ok('没有 `const _pid = feishuId()` 硬编码公开通道', !/const\s+_pid\s*=\s*feishuId\(\)/.test(block));
ok('没有硬编码 channel: \'飞书\'', !/channel:\s*'飞书'/.test(block));
ok('probe 用的是 _psec 而非 feishuSecret 直取', /feishuProbe\(_pid,\s*_psec,\s*txt\)/.test(block));
ok('probe 不再直接写 (S.config && S.config.feishuSecret)', !/feishuProbe\(_pid,\s*\(S\.config\s*&&\s*S\.config\.feishuSecret\)/.test(block));

console.log('\n=== C. 通道名与掩码如实标注 ===');
ok('channel 使用变量 _ch（不写死）', /channel:\s*_ch/.test(block));
ok('私密成功态记为「已送达(私密)」', /已送达\(私密\)/.test(block));
ok('正文标注「体检通道」', /体检通道[:：]/.test(block));
ok('掩码跟着通道走（_maskFn）', /mask:\s*_maskFn\(\)/.test(block));
ok('退回公开时通道名如实标注', /公开·私密未配置/.test(block));

// ── D. 全局回潮检查：test-push 段内不得出现 feishuMask() 裸调用（会拿公开掩码冒充私密）──
console.log('\n=== D. 全局 ===');
ok('test-push 段内无 feishuMask() 裸调用', !/mask:\s*feishuMask\(\)/.test(block));
ok('server.js 仍存在私密通道能力（feishuSecId / feishuSecMask 可复用）',
  /function\s+feishuSecId\s*\(/.test(src) && /function\s+feishuSecMask\s*\(/.test(src));

console.log('\n' + (fail === 0
  ? `✅ 推送通道自检私密优先守门：${pass} 通过 / 0 失败`
  : `❌ 推送通道自检私密优先守门：${pass} 通过 / ${fail} 失败`));
process.exit(fail === 0 ? 0 : 1);
