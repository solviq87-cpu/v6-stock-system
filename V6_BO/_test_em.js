/**
 * em 轮守门测试：竞价期间接近涨停检测 + 全市场刷新间隔
 * 对应第112项任务。
 */
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } }

console.log('\n=== em 轮守门测试 ===\n');

// ① S 初始化
ok(/auctionNearZTNotified\s*:\s*new\s+Set\(\)/.test(SV), 'S 初始化包含 auctionNearZTNotified');

// ② 全市场刷新间隔：硬指标是「不快于 30s（别把数据源打爆）、不慢于 2 分钟（面板别发霉）」
//    （lp 轮按用户「数据及时性」把 2min 提到 60s，旧断言钉死 2*60*1000 → 假红；钉区间不钉数字）
{
  const m = SV.match(/setInterval\(guard\('allStocks'[\s\S]{0,400}\)\s*,\s*(\d+)\s*\*\s*(?:(\d+)\s*\*\s*)?1000\s*\)/);
  const sec = m ? (+m[1]) * (+(m[2] || 1)) : 0;
  ok(sec >= 30 && sec <= 120, `全市场刷新间隔 = ${sec || '?'} 秒（要求 30~120 秒）`);
}

// ③ tick() 函数体中包含竞价检测逻辑
const tickMatch = SV.match(/async\s+function\s+tick\s*\(\)\s*\{/);
ok(!!tickMatch, '存在 tick() 函数声明');

// 用花括号配对找函数体
let depth = 0, tickBody = '', inTick = false;
for (let i = SV.indexOf(tickMatch[0]) + tickMatch[0].length; i < SV.length; i++) {
  const ch = SV[i];
  if (ch === '{') depth++;
  if (ch === '}') { if (depth === 0) break; depth--; }
  if (inTick || depth > 0) { tickBody += ch; inTick = true; }
}

ok(/auctionPhase\s*\(\s*new\s+Date\s*\(\s*\)\s*\)/.test(tickBody), 'tick() 内调用 auctionPhase(new Date())');
ok(/\b_aph\s*===?\s*1\b/.test(tickBody) && /\b_aph\s*===?\s*2\b/.test(tickBody), 'tick() 内判断竞价时段 phase 1/2');
ok(/_auctionNearZTDs\s*!==?\s*_ds/.test(tickBody), 'tick() 内有跨日清空逻辑');
ok(/gap\s*>\s*0\.5\s*&&\s*gap\s*<\s*2/.test(tickBody), 'tick() 内距涨停范围 0.5%~2%');
ok(/35/.test(tickBody) && /_capYi/.test(tickBody), 'tick() 内有市值门槛逻辑');
// ⛔ fp 轮（2026-10-09）改判据：竞价异动改为「连板梯队分组」(一进二/二进三/三进四/高板/首板冲刺)，
//   每 tick 上限从 3 提到 6，否则 5 个梯队会被 3 的硬上限饿死（分组形同虚设）。这里钉的是「有上限」的语义，
//   数字随设计调整——实现若改回无上限（去掉 slice 或写成 Infinity）本判据会假红，正好拦住回退。
ok(/slice\s*\(\s*0\s*,\s*6\s*\)/.test(tickBody), 'tick() 内每轮最多6只(连板梯队分组后仍有上限)');
ok(/auctionNearZTNotified\.add\s*\(/.test(tickBody), 'tick() 内有去重 add()');
// ⛔ go 轮 A4：该推送改私密（用户决策），调用形态变为 pushAll(msg, false, { private: true })
ok(/pushAll\s*\(\s*msg\s*,\s*false\s*,\s*\{\s*private:\s*true\s*\}\)/.test(tickBody), 'tick() 内调用 pushAll(msg)（go 轮起带 private）');

// ④ 全市场刷新有任务注释
const allStocksIdx = SV.indexOf("guard('allStocks'");
let hasComment = false;
if (allStocksIdx >= 0) {
  const ctx = SV.slice(Math.max(0, allStocksIdx - 300), allStocksIdx + 300);
  hasComment = /第112项|价格更新不及时|2\s*分钟/.test(ctx);
}
ok(hasComment, '全市场刷新代码附近有任务注释');

// ⑤ S.stocks 注释更新
ok(/stocks:\s*\[\]\s*,\s*\/\/\s*全A快照\s*（每2分钟全量刷新）/.test(SV), 'S.stocks 注释 = 每2分钟');

// ⑥ 数据源铁律③ 兜底不许静默：fetchIndustryAll 的新浪行业兜底链失败必须留痕
//    旧实现 catch(e){} 空吞 —— 东财 clist 与新源双挂时，行业映射残缺却无任何信号，运维查不到原因。
//    钉语义（有计数、有汇总 warn、有两源皆不可用的显式 warn），不钉死具体文案。
{
  const EM = fs.readFileSync('em.js', 'utf8');
  const m = EM.match(/async function fetchIndustryAll\([\s\S]*?\n\}/);
  const body = m ? m[0] : '';
  ok(!!body, 'em.js 存在 fetchIndustryAll（全A官方行业拉取）');
  ok(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(body), 'fetchIndustryAll 兜底链无空 catch（失败不被静默吞掉）');
  ok(/fail\+\+/.test(body) && /console\.warn\([^)]*\$\{fail\}/.test(body), '兜底链逐板块失败计数并在结束后汇总 warn');
  ok(/两源皆不可用/.test(body) && /console\.warn/.test(body), '两源皆不可用（<1000）时显式 warn 留痕，不拿残缺映射冒充权威');
}

// ⑦ 数据源铁律③（续）：全A全集缓存写盘失败 + K线三源全失败，两处同样不许静默
//    .universe_cache.json 是「东财分页不全 → 缓存全集+腾讯补价」兜底链的唯一依据；
//    K线三源(东财→腾讯→同花顺)全失败返回 null 是诚实的，但**没日志**就查不出是三源全挂。
{
  const EM2 = fs.readFileSync('em.js', 'utf8');
  const su = EM2.match(/function saveUniverse\([\s\S]*?\n\}/);
  ok(!!su && !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(su[0]), 'saveUniverse 写盘失败有留痕（全A全集缓存是补价兜底链唯一依据）');
  ok(/function _klineAllSrcFail/.test(EM2) && /_klineAllFail\.lastAt\s*>\s*60000/.test(EM2), 'K线三源全失败留痕且 60 秒限频（全A逐票调用防日志洪水）');
  const fkc = EM2.match(/async function _fetchKlineCore\([\s\S]*?\n\}/);
  ok(!!fkc && !/catch\s*\{\s*return null;\s*\}/.test(fkc[0]), '_fetchKlineCore 三源全失败不再静默 return null');
}

// ⑧ 数据源铁律③（续）：涨停池 / 涨停原因 / 资金流 / 外围 —— 兜底链与「最终降级」同样不许静默
//    涨停池是全项目涨跌停计数的唯一权威源（东财封板池 tc）：东财双通道 + 同花顺兜底全空时
//    返回 [] 本身是诚实的（不造假），但必须留痕 —— 否则下游无法区分「今日确实无涨停」与
//    「三源都拉不到」，会把拉取失败直接判成无涨停，复盘/选股整片零输出。
//    钉语义（有统一限频留痕器、关键降级点都接上、不再有裸静默返回），不钉死具体文案。
{
  const EM3 = fs.readFileSync('em.js', 'utf8');
  ok(/function _srcWarn\(tag, msg\)/.test(EM3) && /60000/.test(EM3),
    '统一留痕器 _srcWarn 存在且 60 秒限频（防全A循环/高频轮询刷爆日志）');

  const zt = EM3.match(/async function fetchZTPool\(date\)[\s\S]*?\n\}/);
  ok(!!zt, 'em.js 存在 fetchZTPool（涨停池三源链）');
  ok(!!zt && /_srcWarn\([^)]*三源全空/.test(zt[0]),
    '涨停池三源全空必须显式留痕（不把拉取失败静默成「今日无涨停」）');
  ok(!!zt && !/return t\.length \? t : \[\];/.test(zt[0]),
    '涨停池不再用裸三元静默返回空池');

  const ths = EM3.match(/async function fetchZTPoolThs\(date\)[\s\S]*?\n\}/);
  // 必须剥注释再判：修复时在注释里写了「原 catch { break; } 静默跳过」，
  // 不剥注释正则会匹配到注释文字本身，造成断言恒红（本守门第一版就踩了这个坑）。
  const thsCode = ths ? ths[0].replace(/\/\/.*$/gm, '') : '';
  ok(!!ths && !/catch\s*\{\s*break;\s*\}/.test(thsCode),
    '同花顺涨停池兜底拉取失败不再静默 break');

  const lday = EM3.match(/async function fetchZTPoolLatestDay\(\)[\s\S]*?\n\}/);
  ok(!!lday && /_srcWarn\(/.test(lday[0]),
    '涨停池归属日探测失败有留痕（仍返回空串诚实降级，但可追溯）');

  const ffd = EM3.match(/async function fetchFundFlowDays\(code, days = 6\)[\s\S]*?\n\}/);
  ok(!!ffd && /_srcWarn\(/.test(ffd[0]),
    '资金流日线双通道全失败有留痕（仍返回 null，不拿 0 冒充）');

  const bf = EM3.match(/async function fetchBatchFlowEM\(codes\)[\s\S]*?\n\}/);
  ok(!!bf && !/if \(!j \|\| !j\.data \|\| !j\.data\.diff\) return \[\];/.test(bf[0]),
    '批量资金流整批失败不再静默返回空数组');

  const fg = EM3.match(/async function fetchGlobal\(\)[\s\S]*?\n\}/);
  ok(!!fg && (fg[0].match(/_srcWarn\(/g) || []).length >= 2,
    '外围行情两条通道（腾讯/新浪）失败均有留痕');
}

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
