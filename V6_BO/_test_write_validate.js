// 写入端与校验端必须是同一条规则（本轮新角度）—— 不许「先写内存、后校验、失败就跑」。
//
// 故障形态①：/api/config 把【飞书地址 / 密钥】先写进 S.config，再往下做数值键的取值域体检；
//   体检不通过时 `return json(ok:false, '配置未保存（现有配置未被改动）')` 就走了 —— **没调 saveCfg()**。
//   于是磁盘上确实是旧的，可【内存里的地址已经被改掉了】：
//     · 面板下一次拉 state 显示的是新地址（或"已停用"），看着像改成功了；
//     · 真推送时按新地址走 —— 地址若是错的，消息从此一条都发不出去；
//     · 若这批里带的是"停用通道"，通道当场就没了，而用户看到的却是"配置未保存"，
//       只会以为一切照旧，直到当天一条推送都收不到才发现。
//   最刺眼的是那句提示本身在撒谎：它声称"现有配置未被改动"，而进程状态恰恰相反。
//   修法：**先算后写** —— 本批改动先攒进 _pending，全部体检通过才一次性落 S.config 并 saveCfg()。
//
// 故障形态②：写入端接受的值，使用端悄悄换成另一个数。
//   项目既定原则是「设 0 = 完全不限」（aq 轮专门改 _govCfg 让 0 能通过），
//   但 pushDailyMsgs / pushMaxPerCode 在使用端被 `Math.max(1, …)` 抬成 1 ——
//   同一个接口里 pushMaxPerDay 的 0 是"不限量"（用 Infinity 正确兑现）、这两个键的 0 却是"每天 1 条"，
//   存进去了、接口回 ok:true、面板照常显示，实际静悄悄变成最严格的档位。
//   pushQuota() 还有一处 `Math.max(3, n)`：填 1 或 2 会被抬成 3。
//   要设下限就在**写入端**用 CFG_RANGE 明确挡住（挡得住、说得清），不要在使用端偷偷改。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// ⛔ 判"代码里还有没有某个写法"必须看**活代码**：本轮在源码里留了说明性注释，
// 注释里会逐字引用旧写法（如 `Math.max(3, n)`），对整份源文件跑正则会永远命中注释 → 假红。
const { stripNoise } = require('./_codescan.js');
const SV_CODE = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

const I_CFG = SV.indexOf("if (p === '/api/config'");
// ⛔ 别写死字符窗口（本项目已踩过 5 次）：往上加几行就把 saveCfg() 挤出窗口 → 假红。
//    改成语义边界：截到**下一个路由分支**为止。
const _I_NEXT = SV.indexOf("if (p === '/api/", I_CFG + 20);
const CFG_END = _I_NEXT > I_CFG ? _I_NEXT : SV.length;
// ⛔ 用剥注释版本：本项目注释里到处引用 saveCfg() / 旧文案来解释历史 bug，
//    indexOf 会先命中注释 → 顺序断言假红（已踩 11 次）。需要读字符串时 keepStrings 已保留。
const CFG_BODY = SV_CODE.slice(I_CFG, CFG_END);

group('[1] /api/config：先算后写（校验通过之前不许碰 S.config）');
{
  ok('/api/config 路由存在', I_CFG > 0);
  ok('路由窗口按语义边界切出（不能退化成整份文件）', CFG_BODY.length > 1000 && CFG_BODY.length < 40000,
    'len=' + CFG_BODY.length);
  ok('窗口内确实含落盘语句 saveCfg()', CFG_BODY.includes('saveCfg()'));
  ok('引入 _pending 暂存本批改动', /const _pending = \{\};/.test(CFG_BODY));
  ok('飞书地址写进 _pending 而不是 S.config', /_pending\.feishuWebhook = fv;/.test(CFG_BODY));
  ok('飞书密钥写进 _pending', /_pending\.feishuSecret = c\.feishuSecret\.trim\(\);/.test(CFG_BODY));
  ok('私密通道地址写进 _pending', /_pending\.feishuSecWebhook = sv;/.test(CFG_BODY));
  ok('私密通道密钥写进 _pending', /_pending\.feishuSecSecret = c\.feishuSecSecret\.trim\(\);/.test(CFG_BODY));
  ok('停用分支同样先写 _pending', /_pending\.feishuWebhook = '';/.test(CFG_BODY) && /_pending\.feishuSecWebhook = '';/.test(CFG_BODY));
  ok('统一落内存的语句在 saveCfg() 之前', (() => {
    const iApply = CFG_BODY.indexOf('for (const k of Object.keys(_pending)) S.config[k]');
    const iSave = CFG_BODY.indexOf('saveCfg()');
    return iApply > 0 && iSave > iApply;
  })());
  ok('先体检后落盘：越界 return 出现在落内存语句之前', (() => {
    const iRet = CFG_BODY.indexOf('if (_bad.length)');
    const iApply = CFG_BODY.indexOf('for (const k of Object.keys(_pending)) S.config[k]');
    return iRet > 0 && iApply > iRet;
  })());
}

group('[2] 反证：整段里「S.config.X = 」只能出现在体检之后（前面一律走 _pending）');
{
  const iApply = CFG_BODY.indexOf('for (const k of Object.keys(_pending)) S.config[k]');
  ok('落内存锚点存在', iApply > 0);
  const before = CFG_BODY.slice(0, iApply);
  // 体检之后、落内存之前允许出现的只有 _cfgIn 那一行（以及 qqMail 合并，它也在体检后）
  const stray = [...before.matchAll(/S\.config\.(feishuWebhook|feishuSecret|feishuSecWebhook|feishuSecSecret)\s*=/g)];
  ok('⚠️ 体检通过之前没有任何一处直接改飞书配置（旧写法就是这里的 bug）',
    stray.length === 0, stray.map(m => m[0]).join(' | '));
  // 数值键只允许在体检后落
  const strayNum = [...before.matchAll(/S\.config\[k\] = Number\(/g)];
  ok('数值键同样只在体检后落内存', strayNum.length === 0, String(strayNum.length));
}

group('[3] 把 CFG_RANGE + 校验函数抽出来真跑：0 / 越界 / 空串 各自的判定');
{
  const mRange = SV.match(/const CFG_RANGE = \{[\s\S]*?\n\};/);
  const mErr = SV.match(/function cfgRangeErrors\(inObj\) \{[\s\S]*?\n\}/);
  ok('CFG_RANGE 可抠出', !!mRange);
  ok('cfgRangeErrors 可抠出', !!mErr);
  const CFG_RANGE = new Function(mRange[0] + '\nreturn CFG_RANGE;')();
  const cfgRangeErrors = new Function(mRange[0] + '\n' + mErr[0] + '\nreturn cfgRangeErrors;')();

  ok('pushDailyMsgs 的 0 是合法值（写入端允许）', cfgRangeErrors({ pushDailyMsgs: 0 }).length === 0);
  ok('pushMaxPerCode 的 0 是合法值', cfgRangeErrors({ pushMaxPerCode: 0 }).length === 0);
  ok('pushMaxPerDay 的 0 是合法值', cfgRangeErrors({ pushMaxPerDay: 0 }).length === 0);
  ok('pushMaxPerDay 的 2 是合法值（写入端接受，使用端就不许改）', cfgRangeErrors({ pushMaxPerDay: 2 }).length === 0);
  ok('越界仍然要拦（2001 > max 2000）', cfgRangeErrors({ pushMaxPerDay: 2001 }).length === 1);
  ok('空串仍然要拦（Number(\'\') === 0 的坑）', cfgRangeErrors({ pushMaxPerDay: '' }).length === 1);
  ok('白名单外的键仍然要拦', cfgRangeErrors({ 不存在的键: 1 }).length === 1);
  ok('两个"条数/次数"键的 hint 都写明了 0 = 不限（写入端与使用端同一语义）',
    /0 = 不限/.test(CFG_RANGE.pushDailyMsgs.hint) && /0 = 不限/.test(CFG_RANGE.pushMaxPerCode.hint));
}

group('[4] 使用端必须原样兑现配置值，不许 Math.max/min 偷偷改');
{
  ok('⚠️ pushQuota 不再有 Math.max(3, n)', !/Math\.max\(3, n\)/.test(SV_CODE));
  ok('pushQuota 的 0 → Infinity（不限）', /return n <= 0 \? Infinity : n;/.test(SV_CODE));
  ok('⚠️ 全项目不再有 Math.max(1, _govCfg(', !/Math\.max\(1, _govCfg\(/.test(SV_CODE));
  ok('当日条数闸门用 >0 判定（0 = 不限条数）', /if \(capTotal > 0 && MSG_STAT\.total >= capTotal\)/.test(SV));
  ok('每票次数闸门用 >0 判定（0 = 不限次数）', /if \(maxPerCode > 0 && rec\.n >= maxPerCode\)/.test(SV));
  ok('govFoot 里 0 显示为「不限」而不是 1', /_mcTxt = _mc > 0 \? String\(_mc\) : '不限'/.test(SV));
  ok('面板接口给的是原始配置值（0 就写 0，不美化成 1）',
    // ⛔ dg 轮改判据：调用点已不带第二个默认值参数（默认值只在 CFG_RANGE.def 里有一份）
    /maxPerCode: _govCfg\('pushMaxPerCode'\)/.test(SV) && /cap: _govCfg\('pushDailyMsgs'\)/.test(SV));
}

group('[5] 行为对照：同一个 0 在三个"条数/次数"键上必须是同一个语义');
{
  // 三个键各自的取值器语义（照抄源码的判定式）
  const quota = n => (n <= 0 ? Infinity : n);
  const capMsg = (n, total) => !(n > 0 && total >= n);
  const capCode = (n, used) => !(n > 0 && used >= n);
  ok('pushMaxPerDay=0 → 不限量', quota(0) === Infinity);
  ok('pushMaxPerDay=2 → 就是 2（不再被抬成 3）', quota(2) === 2);
  ok('pushDailyMsgs=0，已推 5 条仍放行（不限条数）', capMsg(0, 5) === true);
  ok('pushDailyMsgs=8，已推 8 条 → 拦下', capMsg(8, 8) === false);
  ok('pushMaxPerCode=0，已推 5 次仍放行（不限次数）', capCode(0, 5) === true);
  ok('pushMaxPerCode=2，已推 2 次 → 拦下', capCode(2, 2) === false);
  // 旧写法反证（返回 true = 被拦下，与上面"放行=true"的口径相反，命名上区分开）
  const oldBlocked = (n, total) => total >= Math.max(1, n);
  const oldQuota = n => (n <= 0 ? Infinity : Math.max(3, n));
  ok('⚠️ 反证：旧写法下 pushDailyMsgs=0 只推 1 条就被拦（0 实际等于每天 1 条）',
    oldBlocked(0, 1) === true);
  ok('⚠️ 反证：旧写法下 pushDailyMsgs=8 反而不受影响（说明 bug 只在小数值上发作）',
    oldBlocked(8, 8) === true && capMsg(8, 8) === false);
  ok('⚠️ 反证：旧写法下 pushMaxPerDay=2 被抬成 3', oldQuota(2) === 3);
}

console.log(`\n===== 写入端与校验端一致性 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
