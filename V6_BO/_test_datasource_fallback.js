// 数据源兜底守门测试（K线 / 涨停池）：确保「东财接不通时还有腾讯、腾讯也挂了还有同花顺」
// 在代码里真的生效，而不是只写在注释里。2026-10-02 实测东财 push2 连不上(HTTP 000)、
// push2his 返回 rc:102 data:null，而当时 K线降级链只到腾讯一层 —— 腾讯一旦挂，
// 所有依赖 K 线的模块整片空白；涨停池更是东财单源，EMX 不通就静默空数组
// （调用方 Promise.allSettled 会把 reject 也吞成 null），复盘首行整天没有。
// 而不是只写在注释里。2026-10-02 实测东财 push2 连不上(HTTP 000)、push2his 返回 rc:102 data:null，
// 而当时降级链只到腾讯一层 —— 腾讯一旦挂，所有依赖 K 线的模块整片空白。
//
// 本测试分两段：
//   A. 静态：降级链三个出口都要有同花顺兜底、fetchKlineThs 必须导出、熔断必须存在
//   B. 真跑：拉真数据，验 OHLC 与腾讯一致、成交量单位归一到「手」、科创板不再放大 100 倍
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'em.js'), 'utf8');
const EM = require('./em.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('── A. 静态：降级链与导出 ──');

// 1) fetchKline 东财判死分支：原来只试腾讯就 return，腾讯一挂整函数在熔断期内是死的
ok('fetchKline 东财熔断分支也走同花顺兜底',
  /if \(emKlineDown\(\)\) \{[\s\S]{0,400}?fetchKlineTx[\s\S]{0,300}?fetchKlineThs[\s\S]{0,200}?\}/.test(s));

// 2) fetchKline catch 分支（东财抛错）：腾讯 → 同花顺
ok('fetchKline catch 分支为 腾讯→同花顺 三级',
  /\} catch \(e\) \{[\s\S]{0,100}?_emKlineBad\(\);[\s\S]{0,300}?fetchKlineTx[\s\S]{0,250}?fetchKlineThs/.test(s));

// 3) fetchKline 东财「返回空但没抛错」分支：也要有同花顺
ok('fetchKline 东财返回空分支为 腾讯→同花顺',
  /东财返回空（没抛错）也要有数据[\s\S]{0,400}?fetchKlineTx[\s\S]{0,250}?fetchKlineThs/.test(s));

// 4) 全市场批量补齐 fetchKlineBulk 也要有同花顺（1480 只缺口全靠这条路径）
ok('fetchKlineBulk 补齐同花顺兜底',
  /await fetchKline\(code, days\)/.test(
    s.slice(s.indexOf('async function fetchKlineBulk'), s.indexOf('async function fetchKlineEM'))));

// 5) 必须导出，否则 server.js 里 em.fetchKlineThs(...) 是 undefined 直接崩
ok('fetchKlineThs 已加入 module.exports',
  /module\.exports = \{[^}]*\bfetchKlineThs\b/.test(s));

// 6) 连败熔断：同花顺挂了也别每只票都去撞一次墙
ok('同花顺K线有连败熔断（thsKlineDown 生效）',
  /function thsKlineDown\(\)[\s\S]{0,80}?_thsKDownUntil/.test(s) &&
  /if \(thsKlineDown\(\)\) return null;/.test(s));

// 7) 路径编号必须是「01」（日K+前复权）。踩过：11 是周K、21 是月K、last180.js 看着像日K其实是周间隔
ok('同花顺K线路径用 01（日K+前复权），不是 11/21',
  /\$\{THS_LINE\}\$\{code\}\/01\/last\.js/.test(s) && !/\/11\/last\.js|\/21\/last\.js/.test(s));

// 8) 字段顺序必须是 开/高/低/收（同花顺），不是腾讯的 开/收/高/低
ok('同花顺字段顺序为 开/高/低/收',
  /open: \+f\[1\] \|\| 0, high: \+f\[2\] \|\| 0, low: \+f\[3\] \|\| 0, close: \+f\[4\] \|\| 0/.test(s));

// 9) 成交量必须 股→手（/100），否则与腾讯/东财口径不一致
ok('同花顺成交量做 股→手 换算',
  /volume: Math\.round\(\(\+f\[5\] \|\| 0\) \/ 100\)/.test(s));

// 9bis) it2（2026-10-19）：同花顺对「当天成交未结算」的票会返回 close 有值但 volume=0 的半成品柱，
//   必须被过滤掉，绝不能写进 .kline_cache 再被 volPricePattern 等当「缩量」误判（is 轮奥士康实证）。
ok('同花顺丢弃 volume=0 的半成品柱（当天成交未结算）',
  /\.filter\(r => r\.close > 0 && r\.volume > 0\)/.test(s));

// 10) 科创板量单位归一（腾讯返回「股」，其它板块是「手」）
ok('腾讯K线对科创板(688/689)做量单位归一',
  /const isSTAR = code\.startsWith\('688'\) \|\| code\.startsWith\('689'\);/.test(s) &&
  /volume: Math\.round\(\+r\[5\] \* unitFix\)/.test(s));

console.log('\n── A2. 静态：涨停池兜底 ──');

// 11) 涨停池必须有同花顺兜底（原来是东财单源，EMX 不通 = 静默空数组）
// ⛔ 2026-10-27：旧写法只看函数头 1200 字符，注释一多（fg 轮补了 turnover 兜底说明）兜底调用就被顶出窗口。
//    改成括号配平取整个 fetchZTPool，钉语义不钉字距。
ok('fetchZTPool 东财失败后走同花顺兜底', (() => {
  const i = s.indexOf('async function fetchZTPool(date) {');
  if (i < 0) return false;
  let d = 0, k = s.indexOf('{', i);
  for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (d === 0) break; } }
  return /fetchZTPoolThs\(date\)/.test(s.slice(i, k + 1));
})());

// 12) 东财主链路必须先试两条通道（Node + curl），别一断连就直接降级
// ⛔ 2026-10-28 断言漂移修复：原正则 parse\(await get\(u\)\)[\s\S]{0,120}?parse\(await curlGet\(u
//   是固定字符窗口，之前一直被 _fetchBoardStocksCore 的同款模式误命中（两通道间距<120），
//   而 fetchZTPool 自身两通道间距 144 字符——改成按函数体钉语义，不再依赖字符数。
ok('fetchZTPool 东财先试 Node 通道再试 curl 通道', (() => {
  const i = s.indexOf('async function fetchZTPool(');
  if (i < 0) return false;
  let d = 0, k = s.indexOf('{', i);
  for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (d === 0) break; } }
  const body = s.slice(i, k + 1);
  return body.includes('parse(await get(') && body.includes('parse(await curlGet(');
})());

// 13) 同花顺「N天M板」必须解析成 连板数+天数+是否连续，不能把 "4天2板" 当连板 2 用
ok('thsHighDays 区分「N天M板」与纯连板（cont 标记）',
  /function thsHighDays[\s\S]{0,320}?cont: \+m\[1\] === \+m\[2\]/.test(s));

// 14) 兜底结果必须标 src，调用方才知道这份数据口径不同（无行业/成交额是推算的）
ok('两源涨停池都标 src（em / ths）',
  /src: 'em'/.test(s) && /src: 'ths'/.test(s));

// 15) fetchZTPoolThs 必须导出（便于单独验证与线上排查）
ok('fetchZTPoolThs / thsHighDays 已导出',
  /module\.exports = \{[^}]*\bfetchZTPoolThs\b[^}]*\bthsHighDays\b/.test(s));

console.log('\n── A3. 静态：兜底数据的下游消费（server.js）──');
const sv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// 16) sectorOfStock 第一层不能因空值判死 —— 否则兜底源的票归属永远查不出来
ok('sectorOfStock 涨停池 sector 为空时继续走后三层，不直接返回空',
  /if \(zt && zt\.sector\) return zt\.sector;/.test(sv) && !/if \(zt\) return zt\.sector;/.test(sv));

// 17) computeMainline 不能造出名为 '' 的假主线（同花顺兜底源下会把全部涨停塞进一组）
ok('computeMainline 跳过无归属的票，不造空组主线',
  /const sec0 = z\.sector \|\| '';[\s\S]{0,200}?if \(!sec0\) continue;/.test(sv));

// 18) 涨停池落库前必须补行业归属（兜底源没有该字段）
// ⚠️ 窗口给宽一点：S.ztPool = zt 与补行业之间还夹着 S.ztCodes 的同步更新与它的说明注释
//    （2026-10-06 把代码集挪到这里，间距变大，500 字符的窗口会漏判）
ok('S.ztPool 赋值后用 sectorOfStock 补齐缺失的行业',
  /S\.ztPool = zt;[\s\S]{0,1500}?sectorOfStock\(\{ code: z\.code, name: z\.name \}\)/.test(sv));

console.log('\n── B. 真跑：多板块两源对照 ──');

const CASES = [
  ['600519', '沪主板'], ['000858', '深主板'], ['002594', '深主板'],
  ['300750', '创业板'], ['688008', '科创板'], ['689009', '科创板CDR']
];

(async () => {
  let ohlcAll = true, volAll = true, thsAlive = 0;
  for (const [c, tag] of CASES) {
    let tx = null, ths = null;
    try { tx = await EM.fetchKlineTx(c, 60); } catch { }
    try { ths = await EM.fetchKlineThs(c, 60); } catch { }
    if (!ths || !ths.rows || !ths.rows.length) {
      console.log(`⚠️  ${c} ${tag}：同花顺无数据（跳过对照）`);
      continue;
    }
    thsAlive++;
    if (!tx || !tx.rows || !tx.rows.length) { console.log(`⚠️  ${c} ${tag}：腾讯无数据（跳过对照）`); continue; }

    // 取两源【同日期】的最后 3 个交易日做 OHLC 逐字段比对
    // ⛔ mv 轮修（2026-10-29）：原来按「各取末 3 根」下标对比 —— 同花顺当日柱常滞后
    //   （收盘后数小时仍只有昨日柱，实测 last.js 停在 20261028），下标一对就拿
    //   腾讯的今日 vs 同花的昨日 → 量/OHLC 全错位假红。判据一字不松（同日两源必须一致、
    //   量比容差仍 2%），只把对比对齐到共同交易日；缺当日柱注明不硬比（判不出不硬判）。
    const thsByDate = new Map(ths.rows.map(r => [r.date, r]));
    const thsLast = ths.rows[ths.rows.length - 1].date;
    const txLast = tx.rows[tx.rows.length - 1].date;
    const lagNote = thsLast !== txLast ? `（同花顺末柱 ${thsLast} 落后腾讯 ${txLast}，按共同日对比）` : '';
    const common = tx.rows.filter(r => thsByDate.has(r.date)).slice(-3);
    if (common.length < 2) { console.log(`   ${c} ${tag}: 两源共同交易日 <2，无法对照${lagNote}`); continue; }
    let sameOHLC = true, sameVol = true, detail = '';
    for (const A of common) {
      const B = thsByDate.get(A.date);
      if (A.open !== B.open || A.high !== B.high || A.low !== B.low || A.close !== B.close) {
        sameOHLC = false;
        detail = `${A.date} 腾讯 ${A.open}/${A.high}/${A.low}/${A.close} vs 同花 ${B.open}/${B.high}/${B.low}/${B.close}`;
      }
      const r = B.volume ? A.volume / B.volume : 0;
      if (Math.abs(r - 1) > 0.02) {
        sameVol = false;
        detail = `vol 腾讯 ${A.volume} vs 同花 ${B.volume} 比值 ${r.toFixed(3)}`;
      }
    }
    if (!sameOHLC) ohlcAll = false;
    if (!sameVol) volAll = false;
    console.log(`   ${c} ${tag}: OHLC ${sameOHLC ? '一致' : '❌' + detail} | 量 ${sameVol ? '一致' : '❌' + detail}${lagNote}`);
  }

  ok(`同花顺K线在多板块可用（${thsAlive}/${CASES.length} 个板块拿到数据）`, thsAlive >= 5);
  ok('两源 OHLC 完全一致（前复权口径对齐）', ohlcAll);
  ok('两源成交量单位一致（归一到手，含科创板）', volAll);

  // 成交额反推：同花顺 amount/(volume*close) 应 ≈100（volume 是手）
  let amtOk = true;
  for (const [c] of CASES.slice(0, 4)) {
    const ths = await EM.fetchKlineThs(c, 20);
    if (!ths || !ths.rows.length) continue;
    const r = ths.rows[ths.rows.length - 1];
    const k = r.amount / (r.volume * r.close);
    if (!(Math.abs(k - 100) < 5)) { amtOk = false; console.log(`   ${c} amt/(vol*close)=${k.toFixed(2)} 异常`); }
  }
  ok('同花顺成交额与量价自洽（amount/(vol*close)≈100 → vol 确为手）', amtOk);

  console.log('\n── C. 真跑：涨停池两源 ──');

  // 连板解析：首板=1 / "2天2板"=2且连续 / "4天2板"=2但不连续（4天里断过）
  const hd = EM.thsHighDays;
  ok('thsHighDays("首板") = 1板', hd('首板').lbc === 1);
  ok('thsHighDays("3天3板") = 3板且连续', hd('3天3板').lbc === 3 && hd('3天3板').cont === true);
  ok('thsHighDays("4天2板") = 2板但【不连续】(4天里断过，不能当连板2用)',
    hd('4天2板').lbc === 2 && hd('4天2板').streakCont === undefined && hd('4天2板').cont === false && hd('4天2板').days === 4);

  // 真拉一次历史交易日的同花顺涨停池，验证字段齐全（封单/市值/连板/题材）
  const ztThs = await EM.fetchZTPoolThs('20260930');
  ok('同花顺涨停池能拉到数据（2026-09-30）', Array.isArray(ztThs) && ztThs.length > 0, `实际 ${ztThs && ztThs.length} 只`);
  if (ztThs.length) {
    const a = ztThs[0];
    ok('涨停池字段齐全（封单额/流通市值/换手/连板/题材）',
      a.sealAmount > 0 && a.floatCap > 0 && a.turnover > 0 && a.limitUpCount >= 1 && !!a.name);
    ok('成交额由 流通市值×换手率 推算且与量价自洽（非 0 / 非 NaN）',
      Number.isFinite(a.amount) && a.amount > 0);
    const maxLb = Math.max(...ztThs.map(x => x.limitUpCount));
    ok(`连板梯队可算（最高 ${maxLb} 板，共 ${ztThs.length} 只）`, maxLb >= 1);
    ok('兜底数据标 src=ths（调用方据此知道无行业字段）', ztThs.every(x => x.src === 'ths'));
  }

  // 主链路：东财通就走东财，通不过也不能返回空（必须落到同花顺）
  const zt = await EM.fetchZTPool('20260930');
  ok('fetchZTPool 主链路有输出（东财或同花顺任一可用）', Array.isArray(zt) && zt.length > 0,
    `实际 ${zt && zt.length} 只 src=${zt && zt[0] && zt[0].src}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
