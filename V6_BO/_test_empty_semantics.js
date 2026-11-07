// 空值语义守门测试（本轮角度：把「取不到」当成「确实没有」）。
// 数据源被限流 / 实例冷启动 / 行情还没回来时，上游池就是空的；老写法在此时顺手把结果池
// 覆盖成空（`if (!base.length) { S.bigMoney = {time, items: []}; return []; }`），
// 于是面板与推送上呈现的是"今日无大单 / 今日无涨停" —— 真相是数据没回来，上一次算好的
// 结果被自己的兜底抹掉了。这条原则 refreshSectorsZT 早就立住了（`if (zt && zt.length)`），
// 本测试把它钉到扫描池与复盘就绪判定上。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src);

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// ══ [1] marketReady：区分「没拉到」与「确实没有」════════════════════════════
group('[1] marketReady 判据');
ok('存在 marketReady 且其判据是 S.stocks 长度',
  /const marketReady = \(\) => \(S\.stocks \|\| \[\]\)\.length > 0;/.test(src));
{
  const f = new Function('S', 'return (S.stocks || []).length > 0;');
  ok('全A快照 4000 只 → 就绪', f({ stocks: new Array(4000).fill(1) }) === true);
  ok('⛔ 全A快照 0 只 → 未就绪（数据源没回来）', f({ stocks: [] }) === false);
  ok('S.stocks 缺失 → 未就绪', f({}) === false);
}

// ══ [2] 七处「上游为空就清空结果池」必须有 marketReady 守着 ═════════════════
group('[2] 结果池不许被「没拉到」抹掉');
const POOLS = ['bigMoney', 'pre', 'buzhang', 'review', 'nextplan', 'myrules'];
const clearLines = [];
const codeLines = code.split('\n');      // 剥掉注释后的等长版本：注释里举的反面例子不算数
src.split('\n').forEach((l, i) => {
  // ⚠️ 别只认 `= {`：复盘那两处（2026-10-07）改成了 `S.review = mkReviewShell([])`
  //    （构造收成唯一入口，日期要跟着数据一起落盘），字面量没了但"清空结果池"的语义还在。
  if (!/S\.\w+ = (\{|mkReviewShell\()/.test(codeLines[i] || '')) return;   // 注释里的示例，跳过
  // 形如 `S.xxx = { ... items: [] ... }` 且是"清空"语义（items 直接给空数组 / plan:null / empty:'候选池为空'）
  const m = new RegExp('S\\.(' + POOLS.join('|') + ') = (\\{|mkReviewShell\\()').exec(l);
  if (!m) return;
  // ⚠️ 复盘那两处（2026-10-07）改成了 `S.review = mkReviewShell([])`（构造收成唯一入口，
  //    日期要跟着数据一起落盘）—— 不再是字面量，但"清空结果池"的语义没变，必须照样算进来。
  // ⛔ 2026-10-27 mp 轮改钉：复盘两处改用 poolConfirmedEmpty()（= marketReady && 涨停池确实
  //    拉过 && 20 分钟内），比 marketReady 更严，语义只强不弱；旧判据只认字面 marketReady → 假红。
  const isClear = /items: \[\]|plan: null|empty: '|mkReviewShell\(\[\]\)/.test(l);
  if (isClear) clearLines.push({ line: i + 1, pool: m[1], text: l.trim().slice(0, 80), guarded: /marketReady\(\)|poolConfirmedEmpty\(\)/.test(l) });
});
ok(`⛔ 找到 ${clearLines.length} 处「清空结果池」的赋值，每一处都有 marketReady 守卫`,
  clearLines.length >= 7 && clearLines.every(x => x.guarded));
for (const c of clearLines.filter(x => !x.guarded)) console.log(`  ⚠️ 行 ${c.line} 未守卫：${c.text}`);
// ⛔ dm 轮改判据：原来钉 `if (marketReady()) S.` 的单行写法，这些分支改成 if/else 块后假红。
//    钉语义：**清空动作必须紧跟在 marketReady 判定之后**（允许带花括号）。
ok('守卫写法是「只有行情源就绪才清空」（而不是无条件清空）',
  (src.match(/if \((?:marketReady|poolConfirmedEmpty)\(\)\)[\s\S]{0,4}S\./g) || []).length >= 7,
  '实得 ' + (src.match(/if \((?:marketReady|poolConfirmedEmpty)\(\)\)[\s\S]{0,4}S\./g) || []).length);
// 反证：无条件清空会把上一次有效结果抹掉
{
  const old = (S, pool) => { S[pool] = { time: 't', items: [] }; };            // 旧写法
  const now = (S, pool, marketReady) => { if (marketReady) S[pool] = { time: 't', items: [] }; };  // 新写法
  const s1 = { bigMoney: { time: '15:20', items: [{ code: '600000' }] } };
  const s2 = { bigMoney: { time: '15:20', items: [{ code: '600000' }] } };
  old(s1, 'bigMoney');                       // 数据源没回来
  now(s2, 'bigMoney', false);                // 数据源没回来
  ok('反证：旧写法在数据源没回来时把大单池抹成空', s1.bigMoney.items.length === 0);
  ok('⛔ 新写法在数据源没回来时保留上一次结果', s2.bigMoney.items.length === 1);
  now(s2, 'bigMoney', true);                 // 行情源真的有数据、确实没票 → 该清就清
  ok('行情源就绪且确实没票时仍然清空（不会永久抱住旧数据）', s2.bigMoney.items.length === 0);
}

// ══ [3] 复盘就绪判定：涨停池没拉到 ≠ 今天真的没有涨停 ═══════════════════════
group('[3] 复盘就绪判定（0 条时该重试还是该推）');
const outer = /if \(!it\.length && \(([\s\S]*?)\)\) \{\s*\n\s*reviewTries\+\+;/.exec(src);
const inner = /if \((reviewTries <= 5(?:\s*\|\|\s*!marketReady\(\))?)\)[\s\S]{0,40}?\{/.exec(src);
ok('拿到复盘就绪判定的源码片段', !!(outer && inner));
if (outer && inner) {
  // 把源码里的判定式原样跑起来：返回 'retry' 表示本轮不推、保留重试；'push' 表示要推
  const decide = new Function('it', 'S', 'marketReady', 'reviewTries',
    `if (!it.length && (${outer[1]})) { reviewTries++; if (${inner[1]}) return 'retry'; }\nreturn 'push';`);
  ok('⛔ 涨停池 0 只 + 全A 0 只（数据没回来）→ 重试，不许推"今日无涨停"',
    decide([], { ztPool: [], stocks: [] }, () => false, 0) === 'retry');
  ok('⛔ 同上，试了很多轮之后依然重试（数据一天没回来也不能编一条假的）',
    decide([], { ztPool: [], stocks: [] }, () => false, 40) === 'retry');
  ok('涨停池 3 只却算出 0 条（计算没成功）→ 前几轮重试',
    decide([], { ztPool: [1, 2, 3], stocks: new Array(4000) }, () => true, 0) === 'retry');
  ok('涨停池 3 只、重试超过 5 轮 → 认了（避免无限重试，与旧行为一致）',
    decide([], { ztPool: [1, 2, 3], stocks: new Array(4000) }, () => true, 6) === 'push');
  ok('真算出 5 条 → 正常推送', decide([1, 2, 3, 4, 5], { ztPool: [1], stocks: new Array(4000) }, () => true, 0) === 'push');
  ok('行情源就绪、涨停池真的 0 只 → 推（那天确实没涨停）',
    decide([], { ztPool: [], stocks: new Array(4000) }, () => true, 0) === 'push');
  // 反证：旧判据 `!it.length && ztPool.length > 0` 在涨停池没拉到时不重试
  const oldDecide = new Function('it', 'S', 'marketReady', 'reviewTries',
    `if (!it.length && (S.ztPool || []).length > 0) { reviewTries++; if (reviewTries <= 5) return 'retry'; }\nreturn 'push';`);
  ok('反证：旧判据下涨停池没拉到就直接推送（把"今日无涨停"当成结论）',
    oldDecide([], { ztPool: [], stocks: [] }, () => false, 0) === 'push');
}

// ══ [4] 上游源头的保护不许退化 ══════════════════════════════════════════════
group('[4] 源头的「取不到就不覆盖」保护');
ok('涨停池：只在真的取到时才覆盖 S.ztPool', /if \(zt && zt\.length\) \{[\s\S]*?S\.ztPool = zt;/.test(src));
ok('板块池：只在取到时（或已有值不为空时才兜底）才动 S.sectors',
  /if \(ind && con && ind\.length && con\.length\)/.test(src) && /\} else if \(!S\.sectors\.length\) \{/.test(src));
ok('⛔ 板块兜底重拉失败不许静默（要有日志）—— 静默失败清单里的老坑',
  /板块流兜底重拉失败/.test(src));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
