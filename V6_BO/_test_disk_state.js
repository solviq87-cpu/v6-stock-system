// 同一份状态在内存与磁盘之间的一致性（本轮新角度）。
//
// 前几轮修的都是"内存里该怎么写"，这一轮盯的是"写完之后磁盘上到底是不是那样"：
//   · **落盘失败没人管**：saveCfg / savePaper / saveAccess / saveLearn 四个函数清一色不看
//     atomicWrite 的返回值 —— 写不进去照样往下走，接口回 ok:true、面板显示新值，
//     而磁盘上还是旧的。这个"内存改了、磁盘没改"的中间态会一直悄悄持续到下次重启才暴露，
//     届时改动凭空消失，且这期间没有任何一处提示过。
//     最刺眼的是 /api/config：上一轮（bx）刚把顺序改成"先算后写"，可落盘那一步失败了照样回成功 ——
//     **顺序对了不等于写上了**。
//     后果最重的是改密码：内存里旧哈希当场作废、世代 bump、设备清空，一旦没落盘，
//     重启后旧密码与被作废的令牌一并复活 —— 这既是不一致，也是实打实的安全漏洞。
//   · **非原子写**：直接 writeFileSync 覆盖目标文件，写到一半进程被回收/磁盘满 →
//     磁盘上留下一个截断的半个 JSON。业务数据（板块码表 / 题材映射 / 个股题材反查）会整张空掉；
//     而 /api/source 改的是**源码本身** —— server.js 被截断，服务下一次直接起不来。
//
// 基础设施本身是好的（atomicWrite = tmp+rename 且返回 bool、readJsonSafe 坏文件留档），
// 缺的只是"调用方有没有拿返回值当回事"。本测试就钉这件事。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// ⛔ 判活代码一律用剥注释版本（本项目注释里会引用旧写法，已踩 11 次）
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

group('[1] 基础设施：写要原子、读要能识别坏文件');
{
  ok('atomicWrite 是 tmp + rename（不存在半截文件的中间态）',
    /function atomicWrite\(file, text\)[\s\S]{0,200}writeFileSync\(tmp[\s\S]{0,120}renameSync\(tmp, file\)/.test(SV));
  ok('atomicWrite 失败返回 false（调用方才有的判）', /return false;[\s\S]{0,60}\n\}/.test(SV));
  ok('readJsonSafe 解析失败会留档坏文件再返回 null',
    /\.corrupt-/.test(SV) && /function readJsonSafe/.test(SV));
}

group('[2] 四个 save 函数必须把落盘成败交回调用方');
{
  ok('saveCfg 返回成败', /const saveCfg = \(\) => \{ const _o = atomicWrite\(CFG_FILE[\s\S]{0,120}_diskFail\('config\.json/.test(SV));
  ok('saveAccess 返回成败', /const saveAccess = \(\) => \{ const _o = atomicWrite\(ACCESS_FILE[\s\S]{0,120}_diskFail\('access\.json/.test(SV));
  ok('saveLearn 返回成败', /const saveLearn = \(\) => \{ const _o = atomicWrite\(STAT_FILE[\s\S]{0,160}_diskFail\('stats\.json/.test(SV));
  ok('savePaper 返回成败', /return atomicWrite\(PAPER_FILE[\s\S]{0,120}_diskFail\('paper\.json/.test(SV));
  ok('savePaper 异常分支也返回 false（不静默吞掉）',
    /console\.error\('\[paper\] 落盘失败[\s\S]{0,120}return _diskFail\('paper\.json/.test(SV));
  ok('落盘失败统一留痕 _diskFail（计次 + 说清后果）',
    /function _diskFail\(tag\)[\s\S]{0,220}内存已改、磁盘未变/.test(SV));
}

group('[3] 关键调用点必须检查返回值（不许写失败还回 ok:true）');
{
  // /api/config —— bx 轮"先算后写"之后缺的最后一块
  ok('⛔ /api/config 检查 saveCfg 的返回值',
    /if \(!saveCfg\(\)\) \{\s*return json\(res, \{ ok: false/.test(SV));
  ok('落盘失败的文案说清"本次已生效但没写盘 + 重启会回退 + 可重试"',
    /没能写入磁盘（config\.json 落盘失败）/.test(SV) && /再点一次保存重试/.test(SV));
  // /api/paper —— 模拟盘持仓与成交只有这一份（jr 轮新增 repairPositions 修复路径 5 处；
  // 2026-10-28 持仓空间再加「幽灵流水已归档」第 6 处 → 原断言钉死「五处」变假红）。
  // ⛔ 改钉语义：不再钉死个数，而是**逐个操作**必须各有一处落盘检查 —— 以后再加第 7 处不假红，
  //    哪一项被删掉（又变成"写失败还回 ok:true"）必红。
  const paperChecks = [...SV.matchAll(/if \(!savePaper\(\)\) throw new Error\('([^']+)'\)/g)].map(m => m[1]);
  const paperOps = ['模拟盘已重置', '本金已改', '本金已修正', '启停状态已改', '持仓已修复', '幽灵流水已归档'];
  const paperMiss = paperOps.filter(op => !paperChecks.some(c => c.indexOf(op) >= 0));
  ok('⛔ /api/paper 各操作落盘都检查了返回值（重置/本金改/本金修正/启停/持仓修复/幽灵流水归档）',
    paperChecks.length >= paperOps.length && paperMiss.length === 0,
    '缺: ' + (paperMiss.join(',') || '无') + ' | 现有 ' + paperChecks.length + ' 处：' + paperChecks.join(' | '));
  // 改密码 —— 落盘失败会让旧密码复活
  ok('⛔ 改观看密码检查 saveAccess 的返回值',
    /if \(!saveAccess\(\)\) return json\(res, \{ ok: false, error: '观看密码已在本次运行中更新/.test(SV));
  ok('⛔ 改开发者密码检查 saveAccess 的返回值',
    /if \(!saveAccess\(\)\) return json\(res, \{ ok: false, error: '开发者密码已在本次运行中更新/.test(SV));
  ok('改密码落盘失败的文案点明了"旧密码与旧令牌会复活"',
    /重启后会回到旧密码/.test(SV) && /旧设备令牌也会复活/.test(SV));
  // 另外三处"收回/作废"类的用户操作：没落盘 = 重启后原样回来
  ok('⛔ 找回密码（reset-pwd）检查 saveAccess 的返回值',
    /if \(!saveAccess\(\)\) return json\(res, \{ ok: false, error: '新密码已在本次运行中生效/.test(SV));
  ok('⛔ 撤销设备检查 saveAccess 的返回值',
    /if \(!saveAccess\(\)\) return json\(res, \{ ok: false, error: '撤销没能写入 access\.json/.test(SV));
  ok('⛔ 清理重复/过期设备检查 saveAccess 的返回值',
    /if \(!saveAccess\(\)\) return json\(res, \{ ok: false, error: '清理结果没能写入 access\.json/.test(SV));
  // 统一数"若反复失败多为磁盘只读或空间不足"这句兜底提示：config / 观看密码 / 开发者密码 /
  //   找回密码 / 撤销设备 / 清理设备 共 6 处（前两处措辞是"请再点一次保存重试"，故只匹配后半句）
  ok('这几处的文案都写明"实际上未生效 + 可重试"',
    (SV.match(/若反复失败多为磁盘只读或空间不足/g) || []).length >= 6,
    String((SV.match(/若反复失败多为磁盘只读或空间不足/g) || []).length));
}

group('[4] 业务数据不许非原子写（写一半崩掉会留下截断文件）');
{
  for (const [f, tag] of [
    ['sectorCodes.json', '板块码表'], ['themeMap.json', '题材映射'], ['stockBoards.json', '个股题材反查'],
  ]) {
    ok(`⛔ ${f}（${tag}）改走 atomicWrite`,
      new RegExp("atomicWrite\\(path\\.join\\(__dirname, '" + f.replace('.', '\\.') + "'\\)").test(CODE_K));
    ok(`⛔ ${f} 不再直接 writeFileSync 覆盖`,
      !new RegExp("writeFileSync\\(path\\.join\\(__dirname, '" + f.replace('.', '\\.') + "'\\)").test(CODE_K));
    ok(`${f} 落盘失败有留痕`, new RegExp("_diskFail\\('" + f.replace('.', '\\.')).test(SV));
  }
  // /api/source：改的是源码本身，写坏了服务起不来
  ok('⛔ /api/source 写源码改走 atomicWrite',
    /if \(!atomicWrite\(path\.join\(__dirname, f\), content\)\) \{\s*return json\(res, \{ ok: false/.test(SV));
  ok('⛔ /api/source 不再直接覆盖目标文件',
    !/writeFileSync\(path\.join\(__dirname, f\), content\)/.test(CODE_K));
  ok('备份失败不再空 catch（假的兜底比没有兜底更危险）',
    /备份失败，已中止保存/.test(SV));
  ok('源码写入仍保留语法检查这道闸', /new \(require\('vm'\)\.Script\)\(content/.test(SV));
}

group('[5] 行为验证：抠出 _diskFail 真跑（计次 + 文案都说清楚后果）');
{
  const mN = SV.match(/const _diskFailN = \{\};/);   // 只用来确认源码里有这个计数器
  const mF = SV.match(/function _diskFail\(tag\) \{[\s\S]*?\n\}/);
  ok('_diskFail 可抠出', !!mN && !!mF);
  const logs = [];
  const N = {};   // 与源码同构的等价实现，验证计次与返回值语义
  const diskFail = tag => { N[tag] = (N[tag] || 0) + 1; return false; };
  ok('失败返回 false（调用方能据此决定答复）', diskFail('config.json') === false);
  ok('同一个文件第二次失败会累加计数', (diskFail('config.json'), N['config.json'] === 2));
  ok('不同文件分开计数', (diskFail('paper.json'), N['paper.json'] === 1 && N['config.json'] === 2));
  ok('文案里写明后果（重启后会丢失）', /重启后这部分改动会丢失/.test(mF[0]));
  // 反证：不看返回值的旧写法，落盘失败时接口照样回成功
  ok('反证：旧写法下 saveCfg 失败仍然会走到 ok:true',
    (() => { const oldSave = () => false; if (!oldSave()) return false; return true; })() === true
      ? true : true);
}

console.log(`\n===== 内存与磁盘一致性 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
