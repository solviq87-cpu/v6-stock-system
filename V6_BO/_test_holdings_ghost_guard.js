// 🧟 幽灵持仓防线守门（ld 轮 2026-10-27）—— _test_holdings_ghost_guard.js
// 根因：发布包循环搬运复活 —— sync 把线上磁盘 holdings.json 拉进包 → 包发回线上 →
//   容器回收冷启动回退发布包 → 用户已删的票（600519，10-23 晚 / 10-27 凌晨两次实证）随旧包
//   复活 → 触发真告警。ops 流水交叉核验救不了：回退时 ops 跟包一起回退，证据原地蒸发
//   （实测线上 ops=0 条）。
// 修法两件套：
//   ① server.js pullHoldingsDownstream 拉取校验通过后记「拉取观测史」（本地专用，不进包）；
//   ② _publish.py 发布包统一过 ghost_filter_holdings：addedAt 早于最后一次观测 + 观测不含它
//      + ops 无更晚 re-add/restore 证据 → 定罪复活，逐票剔除；判不出一律放行。
// 本套件：静态钉语义（防线不被删/不许静默失败）+ spawn 真跑 ghost_filter_holdings 全场景。
const fs = require('fs');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
function sec(t) { console.log('\n' + t); }

const readVF = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SV = readVF('server.js');
const PUB = readVF('_publish.py');

// ═══════════ ① 观测史必须真的在记（server.js）═══════════
sec('① 拉取观测史（server.js）：拉取校验通过才记、失败不许静默');
{
  ok(/const PULL_HIST_FILE = path\.join\(__dirname, '\.holdings_pull_history\.json'\)/.test(SV),
    '观测史落盘常量存在（.holdings_pull_history.json，本地专用）');
  ok(/function _recordPullHistory\(codes\)/.test(SV), '_recordPullHistory 已定义');

  // 调用点必须在拉取校验 throw 之后 —— 拉不到 = 没观测，绝不记史（回拉三原则）
  const vThrow = SV.indexOf("if (!hs || !hs.ok || !Array.isArray(hs.items)) throw");
  const vCall = SV.indexOf('_recordPullHistory(onlineCodes)');
  ok(vThrow > -1 && vCall > vThrow, '调用点在校验 throw 之后（拉不到绝不记史）',
    vCall < vThrow ? '调用点在校验之前 → 拉取失败也会记史，观测史会被污染' : '未找到调用或校验');

  // 落盘失败必须留日志，不许空 catch（不报错但悄悄错的典型形态）
  ok(/拉取史落盘失败/.test(SV), '落盘失败留 console.error 日志（不许空 catch）');
  ok(/拉取史读取失败/.test(SV), '读取失败（非 ENOENT）也留日志');

  // 观测史绝不进发布包：DATA_FILES 不含它（进包 = 被线上回退连带污染，证据链失效）
  ok(!/\.holdings_pull_history\.json"[\s\S]{0,40}#.*幽灵/.test(PUB) &&
     !PUB.includes('"​.holdings_pull_history.json"'),
    '观测史不在 _publish.py DATA_FILES（它只能活在本地，进包就会被回退污染）');
  ok(/\.holdings_pull_history\.json/.test(PUB), '_publish.py 会读观测史做判罪（消费方接线）');
}

// ═══════════ ② 发布闸必须存在且不许静默失败（_publish.py）═══════════
sec('② 发布闸（_publish.py）：函数存在、接线、失败留痕');
{
  ok(/def ghost_filter_holdings\(items, pull_hist, ops\):/.test(PUB),
    'ghost_filter_holdings 纯函数已定义（可被真跑测试）');
  ok(/_kept, _conv = ghost_filter_holdings\(/.test(PUB), 'main() 已接线（发布包统一过闸）');
  ok(/幽灵防线自检失败（本轮放行，不影响发布）/.test(PUB), '闸失败打印警告（不许静默放行）');
  ok(/幽灵防线：发布包剔除/.test(PUB), '定罪时打印剔除明细（干预必须留痕）');
  ok(/暂无拉取观测史[\s\S]{0,20}不因判不出丢票/.test(PUB), '无观测史时明示「放行」而非沉默');
}

// ═══════════ ③ 真跑：ghost_filter_holdings 全场景 ═══════════
sec('③ 真跑判据（spawn python import _publish）');
{
  const PY = 'C:/Users/28957/.workbuddy/binaries/python/versions/3.13.12/python.exe';
  const code = `
import json, sys
sys.path.insert(0, '.')
import _publish as P
T_P, CODE = 5000, '600519'
hist_absent = [{'t': 1000, 'codes': [CODE]}, {'t': T_P, 'codes': []}]   # 最后观测不含它
hist_present = [{'t': T_P, 'codes': [CODE]}]                            # 最后观测仍含它
ghost = {'code': CODE, 'name': '贵州茅台', 'addedAt': 1000}              # 旧 addedAt < T_P
readd  = {'code': CODE, 'name': '贵州茅台', 'addedAt': 9000}             # 真重加：addedAt 刷新 > T_P
noat   = {'code': CODE, 'name': '老数据',   'addedAt': 0}                # 无 addedAt：判不出
ops_readd  = [{'t': 6000, 'act': 'add', 'added': [CODE], 'removed': []}]
ops_restore= [{'t': 6000, 'act': 'restore', 'added': [], 'afterBrief': [CODE + '\\u00b7贵州茅台']}]
ops_old    = [{'t': 2000, 'act': 'add', 'added': [CODE], 'removed': []}]  # T_P 之前的证据不算数
out = []
out.append(P.ghost_filter_holdings([ghost], hist_absent, []))            # A 定罪
out.append(P.ghost_filter_holdings([readd], hist_absent, []))            # B 放行
out.append(P.ghost_filter_holdings([ghost], hist_absent, ops_readd))     # C 放行
out.append(P.ghost_filter_holdings([ghost], hist_absent, ops_restore))   # D 放行
out.append(P.ghost_filter_holdings([noat], hist_absent, []))             # E 放行
out.append(P.ghost_filter_holdings([ghost], hist_present, []))           # F 放行
out.append(P.ghost_filter_holdings([ghost], [], []))                     # G 放行
out.append(P.ghost_filter_holdings([ghost, {'code': '000001', 'addedAt': 9000}], hist_absent, []))  # H 逐票
out.append(P.ghost_filter_holdings(None, hist_absent, []))               # I 畸形入参不炸
out.append(P.ghost_filter_holdings([ghost], hist_absent, ops_old))       # J 旧证据不定罪
out.append(P.ghost_filter_holdings([{'code': CODE}], hist_absent, []))   # K 无 addedAt 放行
print(json.dumps(out))
`;
  let res;
  try {
    res = JSON.parse(execFileSync(PY, ['-c', code], { cwd: process.cwd(), timeout: 60000 }).toString());
  } catch (e) {
    ok(false, 'spawn python 真跑失败', (e && e.message || '').slice(0, 200));
    res = null;
  }
  if (res) {
    const conv = r => r[1].map(x => x.code);
    ok(conv(res[0]).length === 1 && res[0][0].length === 0,
      'A 幽灵定罪：addedAt(1000) < 最后观测(5000) 且观测不含它 → 剔除');
    ok(conv(res[1]).length === 0 && res[1][0].length === 1,
      'B 真重加放行：addedAt(9000) > 最后观测 → 保留');
    ok(conv(res[2]).length === 0, 'C ops 有更晚 re-add 记录 → 放行');
    ok(conv(res[3]).length === 0, 'D ops 有更晚 restore 记录（一键还原不刷 addedAt）→ 放行');
    ok(conv(res[4]).length === 0, 'E 无 addedAt 判不出 → 放行（绝不因判不出丢票）');
    ok(conv(res[5]).length === 0, 'F 最后观测仍含它 → 放行（证据不足不定罪）');
    ok(conv(res[6]).length === 0 && res[6][0].length === 1,
      'G 无观测史 → 全部放行');
    ok(conv(res[7]).join(',') === '600519' && res[7][0].map(x => x.code).join(',') === '000001',
      'H 逐票剔除：同包内幽灵剔、正常票留');
    ok(Array.isArray(res[8][0]) && res[8][1].length === 0,
      'I 畸形入参不炸（返回空列表）');
    // J 语义：最后观测（T_P=5000，不含它）比 T_P 之前的 add 记录（t=2000）更权威 ——
    //   旧 add 早被后来的缺席推翻，此刻的旧 addedAt 票仍是回退复活的幽灵 → 定罪。
    //   （曾误写为"放行"，是断言错不是实现错：缺席观测本身就是"已删"的证据。）
    ok(conv(res[9]).join(',') === '600519',
      'J T_P 之前的 ops 证据不定罪 → 改：最后缺席观测更权威，旧 add 已被推翻，仍定罪');
    ok(conv(res[10]).length === 0, 'K 缺 addedAt 字段 → 放行');
  }
}

// ═══════════ ④ 观测史条目不会被 git 带走 ═══════════
sec('④ 防泄漏：观测史不进版本库');
{
  const gi = readVF('.gitignore');
  ok(/\.holdings_pull_history\.json/.test(gi), '.gitignore 已拦 .holdings_pull_history.json（私密业务数据）');
}

console.log('\n════════════════════════════════');
console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
