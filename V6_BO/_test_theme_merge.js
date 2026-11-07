// 主线题材归并守门（2026-10-08 es 轮）
// 起因：用户当场投诉「今天一进二电池板块那么强你怎么不推送，又不是只有电力强」。
// 复盘两个致命坑（都是「不报错、只是悄悄错」型）：
//   ① 板块强度依赖 S.sectors（东财 BK 涨幅榜 Top20）与 ztPool[].sector（另一套题材名）匹配，
//      实测 20 个题材只有 2 个能对上 → 板块涨幅排名20分 + 资金排名20分恒为 0，
//      结果所有板块一律判「弱」、全部票统一扣 3 分 —— 模块不但没帮忙，反而制造无差别噪声，
//      彻底丧失区分度（电池这么强的主线也照样被扣）。
//   ② 同一条主线被拆成多个板块名孤立计算：电池主线实际是 电力设备9 + 电池技术2 + 储能概念2
//      + 锂电池概念1 + 电池1 + 新能源车1 = 16 只涨停，但每个板块名只看到自己那一份，
//      挂「电池」名的力王股份只看到 1 只涨停 → 密度 2 分 → 判弱 → 反而扣分。
// 修法：按【涨停原因关键词（当日真实驱动）+ 板块名兜底】归并到主线，强度按主线聚合计算，
//       五维数据源全部取自 ztPool / 个股快照。本套件把这些钉死，防止改回老逻辑。
// ⛔ 判代码一律用剥注释版本（踩过 11 次）：本次改动在注释里逐字引用了旧函数名与旧数据源，
//    用原始源码做「旧函数已下线」这类反证会被注释里的文字误伤成假红。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const s = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const sn = stripNoise(s);                          // 剥注释+字符串+正则 → 只扫真实代码
const sk = stripNoise(s, { keepStrings: true });   // 保留字符串 → 扫主线关键词表

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// ⛔ 不许固定字符窗口抠函数（踩过 9 次）：按花括号配对取真实函数体
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('{', i);
  if (j < 0) return '';
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

const bThemeKey = fnBody(sn, 'function themeKeyOf');
const bStrength = fnBody(sn, 'function themeStrengthOf');
const bYiEr = fnBody(sn, 'function scanYiEr');
const bLianban = fnBody(sn, 'function scanLianbanRelay');

// 1) 主线归并表必须存在，且覆盖电池这条主线（今天被漏掉的就是它）
ok('主线归并表 THEME_RULES 存在', /const THEME_RULES = \[/.test(sk));
ok('归并表覆盖电池主线关键词（固态电池/储能/锂电）',
  /固态电池/.test(sk) && /储能/.test(sk) && /锂电/.test(sk));

// 2) 归并出口：涨停原因优先（最贴近当日真实驱动），板块名兜底（reason 为空时仍能归并）
//    ⛔ 顺序不能反：板块名先匹配的话，世名科技这类「挂储能概念板块、实为PCB光刻胶」的票会被误并
ok('归并取涨停原因优先、板块名兜底（why 先于 sec）',
  bThemeKey.indexOf('why.indexOf') >= 0 && bThemeKey.indexOf('sec.indexOf') >= 0
  && bThemeKey.indexOf('why.indexOf') < bThemeKey.indexOf('sec.indexOf'));

// 3) 强度计算的数据源必须可靠 —— 不再依赖那套对不上的板块榜
ok('主线强度不再依赖 S.sectors（两套命名对不上，曾致40分恒为0）',
  bStrength.length > 0 && !/S\.sectors/.test(bStrength));

// 4) 必须按主线聚合统计（而不是按孤立板块名各算各的）
ok('按主线聚合涨停梯队（filter 归并同主线）', /filter/.test(bStrength) && /themeKeyOf/.test(bStrength));

// 5) 五维齐全：梯队规模 / 梯队完整 / 连板高度 / 封单 / 资金
ok('五维齐全：规模+完整度+高度+封单+资金',
  /scaleScore/.test(bStrength) && /roleScore/.test(bStrength) && /heightScore/.test(bStrength)
  && /sealScore/.test(bStrength) && /fundScore/.test(bStrength));

// 6) 两个选股入口都必须接上主线强度（只接一个是接了等于没接）
ok('一进二接入主线强度', bYiEr.length > 0 && /themeStrengthOf/.test(bYiEr));
ok('连板接力接入主线强度', bLianban.length > 0 && /themeStrengthOf/.test(bLianban));

// 7) 选股打分里残留的板块榜依赖必须清掉（secPct/secInflow 曾恒不触发，是死代码）
ok('一进二打分不再依赖 S.sectors', bYiEr.length > 0 && !/S\.sectors/.test(bYiEr));
ok('连板接力打分不再依赖 S.sectors', bLianban.length > 0 && !/S\.sectors/.test(bLianban));

// 8) 旧的板块级强度函数已下线，不留死代码（反证必须在剥注释版本上做）
ok('旧板块级强度 sectorStrengthOf 已下线', !/sectorStrengthOf\s*\(/.test(sn));

// 9) 文案要展示归并后的主线，而不是那个被拆散的孤立板块名
//    （判文案用原始源码：模板串内容会被 stripNoise 抹掉）
ok('推送文案展示归并后的主线名', /\$\{ss\.theme\}主线/.test(s));

console.log('\n主线题材归并守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
