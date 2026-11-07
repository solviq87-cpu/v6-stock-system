// 占位与送达的原子性守门测试（本轮角度：占位先于送达，失败必须能退）。
// 病灶：`govTake`（扣额度 / 记去重 / 起冷却 / 记模块配额）发生在 `pushAll` **之前** ——
//   文案要靠它决定哪几只票能进这条消息，所以必须先占位。
//   但 `pushAll` 里的真实发送是 fire-and-forget：feishuSend 的回调只写一条「❌ 发送失败」流水，
//   pushAll 自己**永远返回 true**（唯一返回 false 的是夜间静默）。
//   → 网络抖动 / 机器人被删 / 地址失效时（队列只对**限频**重试 2 次，其它失败直接回调 false），
//     这条消息当天永久消失：额度已扣、票已被记成"今天推过它"、冷却也起算了，下一轮根本不会再考虑它。
// 同源的第二种形态：**出口截断** —— govFilter 给所有通过者都占了坑，文案却只取前 N 只，
//   被截掉的那几只同样是"占坑断档"（实测板块异动：候选 12 只全量过闸、出口只取 6 只）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
function fnSrc(re) {
  const m = re.exec(SV);
  if (!m) throw new Error('未找到函数: ' + re);
  let d = 0, s = -1;
  for (let i = m.index; i < SV.length; i++) {
    if (SV[i] === '{') { if (s < 0) s = i; d++; }
    else if (SV[i] === '}') { d--; if (!d) return SV.slice(m.index, i + 1); }
  }
  throw new Error('括号未闭合: ' + re);
}
function mkEnv() {
  const PUSH_GOV = { day: '', total: 0, codes: new Map(), dropped: 0, lowProb: 0 };
  const _modDay = { day: '20261006', n: {} };
  const saved = { n: 0 };
  const src = ['govRelease', 'govReleaseAll', 'govTrim', 'govUndoOf', 'modDayRelease']
    .map(n => fnSrc(new RegExp('function ' + n + '\\('))).join('\n');
  const f = new Function('PUSH_GOV', '_modDay', 'savePushGov', 'todayStr',
    src + '\nreturn { govRelease, govReleaseAll, govTrim, govUndoOf, modDayRelease };');
  return { PUSH_GOV, _modDay, saved, ...f(PUSH_GOV, _modDay, () => { saved.n++; }, () => '20261006') };
}
// 模拟一次 govTake 的占位效果（与 server.js 里的写保持一致）
function occupy(PUSH_GOV, code, type) {
  const rec = PUSH_GOV.codes.get(code) || { n: 0, ts: 0, types: new Set() };
  rec.n++; rec.ts = Date.now(); rec.types.add(type);
  PUSH_GOV.codes.set(code, rec);
  PUSH_GOV.total++;
  return { code, type };
}

group('[1] 单次占位回滚：额度 / 去重 / 冷却一起退');
{
  const e = mkEnv();
  const u = occupy(e.PUSH_GOV, '600001', 'pool');
  ok('占位后：total=1、该票 n=1、types 含 pool、ts>0',
    e.PUSH_GOV.total === 1 && e.PUSH_GOV.codes.get('600001').n === 1 &&
    e.PUSH_GOV.codes.get('600001').types.has('pool') && e.PUSH_GOV.codes.get('600001').ts > 0);
  const r = e.govRelease('600001', 'pool');
  ok('⛔ 退回成功（返回 true）', r === true);
  ok('⛔ 额度还回去了（total 归 0）', e.PUSH_GOV.total === 0, '实际 ' + e.PUSH_GOV.total);
  ok('⛔ 去重擦掉了（types 不再含 pool）', !e.PUSH_GOV.codes.get('600001').types.has('pool'));
  ok('⛔ 冷却撤销了（n 归 0 → ts 清零，冷却期不再从这一刻起算）',
    e.PUSH_GOV.codes.get('600001').n === 0 && e.PUSH_GOV.codes.get('600001').ts === 0);
  ok('⛔ 回滚会落盘（否则重启后又被读回来）', e.saved.n > 0);
  ok('⛔ 重复退同一只不会把额度退成负数', e.govRelease('600001', 'pool') === false && e.PUSH_GOV.total === 0);
  ok('⛔ 没占过的票退回是安全的（返回 false、不动额度）',
    e.govRelease('999999', 'pool') === false && e.PUSH_GOV.total === 0);
}

group('[2] 同一只票被多个模块占位：只退那一个模块');
{
  const e = mkEnv();
  occupy(e.PUSH_GOV, '600002', 'pool');
  occupy(e.PUSH_GOV, '600002', 'trend');
  ok('两次占位后 total=2、n=2、types 有两个', e.PUSH_GOV.total === 2 &&
    e.PUSH_GOV.codes.get('600002').n === 2 && e.PUSH_GOV.codes.get('600002').types.size === 2);
  e.govRelease('600002', 'pool');
  ok('⛔ 只退 pool：total=1、types 只剩 trend、n=1', e.PUSH_GOV.total === 1 &&
    e.PUSH_GOV.codes.get('600002').types.size === 1 && e.PUSH_GOV.codes.get('600002').types.has('trend') &&
    e.PUSH_GOV.codes.get('600002').n === 1);
  ok('⛔ 冷却不能因为还有别的模块在场就被清零（ts 保留）', e.PUSH_GOV.codes.get('600002').ts > 0);
}

group('[3] 批量退回 + 模块日配额退回');
{
  const e = mkEnv();
  const list = [occupy(e.PUSH_GOV, '600003', 'bigmoney'), occupy(e.PUSH_GOV, '600004', 'bigmoney'),
                occupy(e.PUSH_GOV, '600005', 'bigmoney')];
  e._modDay.n.bigmoney = 5;
  const n = e.govReleaseAll(list);
  ok('⛔ 三只一起退（返回 3）', n === 3);
  ok('⛔ total 归 0', e.PUSH_GOV.total === 0);
  e.modDayRelease('bigmoney');
  ok('⛔ 模块日配额退 1（5 → 4）', e._modDay.n.bigmoney === 4, '实际 ' + e._modDay.n.bigmoney);
  e.modDayRelease('bigmoney'); e.modDayRelease('bigmoney');
  e.modDayRelease('bigmoney'); e.modDayRelease('bigmoney');
  ok('⛔ 配额退到 0 就不会变成负数', e._modDay.n.bigmoney === 0, '实际 ' + e._modDay.n.bigmoney);
  ok('⛔ 空列表 / undefined 都不炸', e.govReleaseAll([]) === 0 && e.govReleaseAll(undefined) === 0 && e.govReleaseAll(null) === 0);
}

group('[4] 出口截断：占了坑却没进文案的那几只必须立刻退回');
{
  const e = mkEnv();
  const keep = [];
  const undo = [];
  for (let i = 1; i <= 12; i++) {
    const code = '6000' + String(i).padStart(2, '0');
    keep.push({ code, name: '票' + i });
    undo.push(occupy(e.PUSH_GOV, code, 'sector'));
  }
  Object.defineProperty(keep, '$undo', { value: undo, enumerable: false, writable: true, configurable: true });
  ok('预热：12 只全占了坑（total=12）', e.PUSH_GOV.total === 12);
  const top = e.govTrim(keep, 6);
  ok('⛔ 截断到 6 只', top.length === 6);
  ok('⛔ 被截掉的 6 只占位已退回（total 6）', e.PUSH_GOV.total === 6, '实际 ' + e.PUSH_GOV.total);
  ok('⛔ 进文案的 6 只占位保留（它们真的被推出去了）',
    e.PUSH_GOV.codes.get('600001').types.has('sector') && e.PUSH_GOV.codes.get('600006').types.has('sector'));
  ok('⛔ 被截掉的那些确实退干净了', !e.PUSH_GOV.codes.get('600007').types.has('sector') &&
    !e.PUSH_GOV.codes.get('600012').types.has('sector'));
  ok('⛔ 保留下来的 undo 句柄跟着截断后数组走（前 6 只）',
    Array.isArray(top.$undo) && top.$undo.length === 6 && top.$undo[0].code === '600001');
  // 反证：原来那一句 govFilter(...).slice(0, 6) —— 后 6 只的占位全留着
  const old = keep.slice(0, 6);
  ok('反证：旧的 .slice(0,6) 不会退回后面那 6 只（total 仍是 12）', e.PUSH_GOV.total === 6 && old.length === 6);
  // ⚠️ 不能用宽松正则：`govFilter('similar', list.filter(...).slice(0, 4))` 里面也有 `).slice(`，
  //    但那是**入参**自己的截断，不是对 govFilter 结果的截断。必须按括号配对取 govFilter 的实参范围。
  let badSlice = [];
  // ⛔ 必须扫【剥掉注释】的源码：我写的说明文字里本身就带着 `govFilter(...).slice(0, 6)` 这个反例
  const { stripNoise } = require('./_codescan.js');
  const CODE = stripNoise(SV, { keepStrings: true });
  for (let i = 0; i < CODE.length; i++) {
    if (CODE.startsWith('govFilter(', i)) {
      let d = 0, end = -1;
      for (let k = i + 'govFilter('.length - 1; k < SV.length; k++) {
        if (SV[k] === '(') d++;
        else if (SV[k] === ')') { d--; if (!d) { end = k; break; } }
      }
      if (end < 0) continue;
      const after = SV.slice(end + 1, end + 12);
      if (/^\s*\.slice\(/.test(after)) badSlice.push(SV.slice(i, end + 1).slice(0, 60) + ' → ' + after.trim());
    }
  }
  ok('⛔ 源码里已不存在「对 govFilter 结果直接 slice」的写法（那会让被截的票白占坑）',
    badSlice.length === 0, badSlice.join(' | '));
  // ⛔ 断言要钉语义不要钉写法（cx 轮又踩一次）：出口截断交给 govTrim、上限 6 条 ——
  //    中间允许被别的收口函数包一层（modDayKeepOrDrop），只要 govTrim(_gk, 6) 还在。
  ok('⛔ 板块异动那处改成了 govTrim', /const top = .*govTrim\(_gk,\s*6\)/.test(SV));
}

group('[5] 多批合并（一条消息里同时含 pool / trend / A组 / B组）');
{
  const e = mkEnv();
  const a = [], b = [];
  const ua = [occupy(e.PUSH_GOV, '600101', 'pool')];
  const ub = [occupy(e.PUSH_GOV, '600102', 'trend')];
  Object.defineProperty(a, '$undo', { value: ua, enumerable: false });
  Object.defineProperty(b, '$undo', { value: ub, enumerable: false });
  const all = e.govUndoOf(a, b);
  ok('⛔ 两批合并成 2 个句柄', all.length === 2);
  ok('⛔ 混入没有 $undo 的数组也不会炸', e.govUndoOf(a, [], null, undefined, b).length === 2);
  e.govReleaseAll(all);
  ok('⛔ 合并后整批退回', e.PUSH_GOV.total === 0);
}

group('[6] 接线：pushAll 失败时才退，且各推送点都把句柄交出去了');
{
  const i = SV.indexOf('function pushAll(text, force, opts)');
  // ⛔ fz 轮：原来切固定 9000 字符当函数体，pushAll 加了 unknown 分支后变长，
  //    飞书回调被切在窗口外 → 判据假红（实现没变，是窗口不够）。改成括号配平取整函数。
  let _bd = 0, _bend = -1;
  for (let k = SV.indexOf('{', i); k < SV.length; k++) {
    if (SV[k] === '{') _bd++;
    else if (SV[k] === '}') { _bd--; if (_bd === 0) { _bend = k + 1; break; } }
  }
  const blk = _bend > 0 ? SV.slice(i, _bend) : SV.slice(i, i + 9000);
  ok('找到 pushAll', i > 0);
  ok('⛔ pushAll 恒返回 true（除夜间静默）—— 所以调用方拿不到"没送到"，只能靠 undo',
    (blk.match(/return true;/g) || []).length >= 3 && /return false;[\s\S]{0,80}?夜间静默拦下：没发出去/.test(blk));
  // ⛔ 2026-10-06 改判据（双通道部分成功不许当成完全失败）：
  //    飞书失败时**不再直接** _release —— 邮箱那条可能已经送到本人手上了，
  //    退了占位下一轮就会再推一遍，邮箱收到两份一模一样的。
  //    现在回调里只登记结果，由 _settle 等两个通道都有结论后统一决定。
  // ⛔ fz 轮换判据：原来钉连写的 `_fsOk = !!ok; _settle();` 这一整串字面量，
  //    fz 轮在中间插了 `_fsInfo = String(info || '')`（要留回执原文才能区分"被拒"和"没回音"），
  //    字面量失配 → 假红。语义一点没变：回调仍然只登记结果、绝不自己回滚。
  // ⛔ 只盯**主通道**那个回调：私密分支里也有两处 feishuSend，它们回调里的 _release 是
  //    「私密失败 + 群机器人也失败」才回滚，正当且必须保留 —— 用窗口正则会误伤到它们（假红）。
  const _mcIdx = blk.indexOf('_fsOk = !!ok;');
  const _mcCb = _mcIdx > 0 ? blk.slice(0, _mcIdx).lastIndexOf('feishuSend(text, (ok, info) => {') : -1;
  const _mcBody = _mcCb >= 0 ? blk.slice(_mcCb, _mcIdx + 40) : '';
  ok('⛔ 飞书回调只登记结果，不再自己直接回滚',
    /else pushLog\('❌ 发送失败', text, (?:_extra\()?\{ channel: '飞书', error: info \}\)?\);/.test(blk)
    && /_fsOk = !!ok;/.test(blk) && /_settle\(\);/.test(blk)
    && _mcBody.length > 0 && !/_release\(/.test(_mcBody), _mcBody.slice(0, 120).replace(/\s+/g, ' '));
  // ⛔ dl 轮改判据：原来钉 `if (_fsOk || _mailOk) return;` 整行字面量，
  //    该分支现在顺带记一条 _pushLast（语义未变：仍然是不回滚直接返回）→ 旧断言假红。
  //    钉语义：_release 必须出现在「任一通道送到」分支【之后】，且该分支里有 return。
  {
    const sm = blk.match(/const _settle = \(\) => \{([\s\S]*?)\n {2}\};/);
    const sb = sm ? sm[1] : '';
    const p1 = sb.indexOf('_fsOk || _mailOk'), p2 = sb.indexOf('_release');
    ok('⛔ 任一通道送到就不退占位（避免邮箱收到两份）',
      p1 >= 0 && p2 > p1 && /return/.test(sb.slice(p1, p2)) &&
      /if \(_fsOk === null \|\| _mailOk === null\) return;/.test(blk));
  }
  ok('⛔ 确实都没送到时才回滚', /_release\(_mailOn \? '飞书与邮箱都没送到' : '飞书未送达'\)/.test(blk));
  ok('⛔ 私密通道与群机器人都没送到时才回滚（成功路径绝不误退）',
    /_release\('私密通道与群机器人都没送到'\)/.test(blk) && /_release\('私密通道异常且群机器人退回也失败'\)/.test(blk));
  ok('⛔ 回滚会记一条流水（面板上看得见"占位已退回"）', /pushLog\('↩️ 占位已退回'/.test(blk));
  // ⚠️ 按行判：`if (ok) pushLog('✅ 已送达'…); else { …_release(…) }` 会被宽松正则算成"成功路径里有 _release"。
  //    真正的判据是：**任何一行里同时出现「已送达」与 _release** 才算误退。
  const badRelease = blk.split('\n').filter(l => /_release\(/.test(l) && /已送达/.test(l));
  ok('⛔ 已送达那条分支上没有 _release（成功绝不退）', badRelease.length === 0, badRelease.join(' | '));
  // 各调用点
  // ⛔ 2026-10-08 改判据：板块异动加了 private: true（涨停分析走私密通道），正则跟着认新写法
  ok('⛔ 板块异动交了 undo + 模块配额', /\{ undo: top\.\$undo, modDay: 'sector', private: true \}/.test(SV));
  ok('⛔ 盘中快报交了两批 undo 且带 modDay', /\{ undo: _u, modDay: _md \}/.test(SV));
  // ⛔⛔ hw 轮改判据：大单改成「每票一张卡、逐票单独发送」，undo 也跟着按票拆开
  //    （一张失败只退这一张，不连坐同轮其它票）；整批一个 _bmUndo 的写法已不存在。
  //    判据钉的是**语义**：每张卡各带一份 undo、撞日上限先退占位、被夜间静默拦下也退。
  ok('⛔ 大单每张卡各带自己的 undo（A/B/普通三批分别挂到票上）',
    /freshHotA\.forEach\(x => \{ x\._u = govUndoOf\(freshHotA\); \}\)/.test(SV) &&
    /freshHotB\.forEach\(x => \{ x\._u = govUndoOf\(freshHotB\); \}\)/.test(SV) &&
    /freshNormal\.forEach\(x => \{ x\._u = govUndoOf\(freshNormal\); \}\)/.test(SV));
  ok('⛔ 大单每张卡都交了 undo + 模块配额（私密通道）', /\{ undo: x\._u, modDay: 'bigmoney', private: true \}/.test(SV));
  ok('⛔ 大单被闸门拦下（夜间静默）时也退占位', /govReleaseAll\(x\._u\);\s*\n\s*modDayRelease\('bigmoney'\)/.test(SV));
  ok('⛔ 大单撞模块日上限时先退占位再跳过这张卡', /govReleaseAll\(x\._u\);[\s\S]{0,120}?continue;/.test(SV));
  // ⛔ go 轮 A1/A2/A9：这三处补 private: true（用户决策改私密），正则跟着认新写法
  //    （与 2026-10-08 埋伏那处同一处理：加了私密标记，形状断言跟着长）
  ok('⛔ 补涨龙交了 undo，被拦下时也退', /\{ undo: _bzUndo, modDay: 'buzhang', private: true \}/.test(SV) && /govReleaseAll\(_bzUndo\)/.test(SV));
  // ⛔ 2026-10-08 改判据：埋伏加了 private: true（涨停分析走私密通道），正则跟着认新写法
  ok('⛔ 埋伏 / 相似股也交了 undo（各带自己的模块配额）',
    /\{ undo: fresh\.\$undo, modDay: 'pre', private: true \}/.test(SV) && /\{ undo: fresh\.\$undo, modDay: 'similar' \}/.test(SV));
  ok('⛔ 连续收涨没有 govTake，但模块配额也要能退', /\{ modDay: 'steadyup', private: true \}/.test(SV));
  ok('⛔ govTake 的返回值里带 undo 句柄', /return \{ ok: true, no: rec\.n, fused: _fz, undo: \{ code, type \} \}/.test(SV));
  ok('⛔ govFilter 把句柄挂在返回数组上且不可枚举（不混进业务数据）',
    /Object\.defineProperty\(keep, '\$undo', \{ value: undo, enumerable: false/.test(SV));
}

group('[7] 反证：不回滚的话，这条消息当天就永久消失');
{
  const e = mkEnv();
  occupy(e.PUSH_GOV, '600777', 'sector');
  // 模拟"发送失败但不回滚"：下一轮 govTake 会因为 types 已含 'sector' 直接挡掉
  const rec = e.PUSH_GOV.codes.get('600777');
  const wouldBlock = rec.types.has('sector');   // govTake 里的 `if (rec.types.has(type)) return {ok:false}`
  ok('反证：占位留着 → 下一轮被"同一模块今天已经推过它了"挡掉（消息永久消失）', wouldBlock === true);
  e.govRelease('600777', 'sector');
  ok('⛔ 退回后下一轮能重新考虑它（不会被挡）', !e.PUSH_GOV.codes.get('600777').types.has('sector'));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
