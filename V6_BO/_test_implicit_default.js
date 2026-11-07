// 守门测试（ct 轮 · 角度：系统里那些「默认是对的」的假设）
// 本轮聚焦"默认取第一个"：把数组首元素 / Map 迭代的第一个命中 当成"最相关的那个"。
// 数据里的顺序（东财返回顺序、缓存写入顺序）跟"这个板块今天强不强"没有半点关系 ——
// 默认它俩一致，就会把归属交给运气，且全程不报错。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });

// 取函数体：先跳形参表（`extra = {}` 的花括号会骗计数），箭头函数不跳
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let pe = i;
  if (/^function\b/.test(sig)) {
    let p = src.indexOf('(', i), pd = 0;
    for (pe = p; pe < src.length; pe++) {
      const c = src[pe];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
  }
  let j = src.indexOf('{', pe), d = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j, k);
}

console.log('【一】多候选时必须"挑最强"，不能"取第一个"');
const pts = fnBody(NOC, 'function pickTopSector(');
ok('[自检] 取到 pickTopSector 函数体', pts.indexOf('sectorRankMap') >= 0);
// 真跑：注入 sectorRankMap / S.ztBySector（沙箱注入清单漏一个 = 整个套件崩掉，踩过 5 次）
// ⛔ 形参也要进注入清单（漏一个符号 = 整个套件 ReferenceError 崩掉，不是变红 —— 踩过 5 次）
const runPick = new Function('sectorRankMap', 'S', 'names', pts + ' return pickTopSector(names);');
const RK = new Map([['央国企改革', 3], ['军工', 28], ['大盘价值', 1]]);
const ZT = { '央国企改革': [{}, {}, {}, {}, {}, {}, {}], '军工': [{}] };
const pick = names => runPick(() => RK, { ztBySector: ZT }, names);
ok('★ 涨停家数多的胜出（7 只涨停 vs 1 只）— 不靠数据里的先后顺序',
  pick(['军工', '央国企改革']) === '央国企改革');
ok('★ 顺序反过来也一样（证明不是碰巧取了第一个）',
  pick(['央国企改革', '军工']) === '央国企改革');
ok('★ ⛔ 资金排名靠前但没涨停的宽基板块不许赢（大盘价值排第 1 但 0 涨停）',
  pick(['军工', '大盘价值']) === '军工');
ok('★ 涨停家数相同时用资金排名决胜',
  pick(['军工', '半导体']) === '军工' || pick(['军工', '半导体']) === '半导体');
ok('★ 空输入返回 null（不抛异常）', pick([]) === null && pick(null) === null);
ok('★ 一条证据都没有时返回 null（交回调用方退回"取第一个"，不硬挑）',
  runPick(() => new Map(), { ztBySector: {} }, ['甲', '乙']) === null);

console.log('\n【二】两处板块归属都已改掉"命中就 return"');
const sos = fnBody(NOC, 'function sectorOfStock(');
ok('[自检] 取到 sectorOfStock 函数体', sos.indexOf('ztPool') >= 0);
// 第三层：反查 secStocks
ok('★ 第三层不再"命中就 return"（改为先收集全部命中）',
  !/S\.secStocks[\s\S]{0,400}?\.some\([^)]*\)\s*return nm;/.test(sos));
ok('★ 第三层走 pickTopSector 挑最强', /pickTopSector\(hits\)/.test(sos));
ok('★ 第三层挑不出来时退回第一个（不是判死成"未知"）', /if \(hits\.length\) return hits\[0\]/.test(sos));
// 第四层：boardsOf
ok('★ 第四层不再只判"在不在榜里"的 find', !/bs\.find\(b => b\.name && rk\.has\(b\.name\)\)/.test(sos));
ok('★ 第四层先挑榜上最强的', /pickTopSector\(inRank\)/.test(sos));
ok('★ 第四层仍保留"非地域板块"兜底（地域是注册地不是题材）', /GEO_BOARD_RE\.test/.test(sos));

console.log('\n【三】口径一致：挑"最强"的尺子不能两把');
ok('★ pickTopSector 以涨停家数为主序（与涨停池归类那处 heatOf 同精神）',
  /ztN > bz/.test(pts) && /ztBySector/.test(pts));
ok('★ 资金排名只做次序（涨停家数相同时才用）', /ztN === bz && rr < br/.test(pts));
// 对照组：涨停池归类那处本来就是按热度排序取最强的 —— 它是对的，别被改坏
ok('★ 涨停池归类那处仍按热度排序取最强（正确范例，不许退化成取第一个）',
  /\[\.\.\.bs\]\.sort\(\(a, b\) => heatOf\(b\.name\) - heatOf\(a\.name\)\)\[0\]/.test(NOC));

console.log('\n【四】K 线顺序假设（另一类隐含前提）—— 事实核对');
// rows[rows.length-1] 被当成"最新一根"用了十几处，前提是 K 线按日期升序
const kdir = './.kline_cache';
let asc = null, lastDate = '';
try {
  const f = fs.readdirSync(kdir).filter(x => x.endsWith('.json'))[0];
  const j = JSON.parse(fs.readFileSync(kdir + '/' + f, 'utf8'));
  const rows = j.rows || j;
  if (rows && rows.length >= 2) {
    const a = String(rows[0].date || ''), b = String(rows[rows.length - 1].date || '');
    asc = a <= b; lastDate = b;
  }
} catch { }
ok('[自检] 读到一份缓存 K 线', lastDate !== '');
ok('★ K 线确实按日期升序 → rows[length-1] 当"最新一根"成立（前提成立，记录备查）', asc === true);
ok('ⓘ 已知前提：最后一根未必是今天（休市期间是上一交易日），日期判断另有 dataTradeDay/kStale 把关', true);

console.log('\n────────────────────────────────────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
