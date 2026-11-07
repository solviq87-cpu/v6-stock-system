// 题材三源交叉守门（2026-10-09 em 轮）
// 起因：用户反复投诉「板块总是统计不准确，可以根据同花顺/东财/通达信结合着一起看」。
// 根因实证（用 2026-10-08 真实数据对比）：
//   · 东财涨停池 hybk 是「单一行业 + 4 字截断」：电池/化学制药/服装家纺/房地产开（房地产开发被截断），
//     不是当日真实炒作题材。
//   · 同花顺涨停池 reason_type 才是「多题材概念」：固态电池+液冷服务器+水处理，
//     每天全量都有（9/30 实测 52/52），但旧代码只在东财挂掉时才走同花顺降级，
//     平时 z.sector 全被东财单一行业占着 → 板块统计对不上主线。
// 修法：把同花顺 reason 里的题材词提出来当 z.sector 主源，题材词先经 themeOfSec 归并到主线
//       （固态电池/磷酸铁锂/锂电池 → 电池·储能），细分词存 z.themes；东财 hybk 行业兜底。
// ⛔ 判代码用剥注释版本（本次改动注释里逐字引用了旧字段名 hybk/reason_type）。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const s = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const sn = stripNoise(s);                          // 剥注释+字符串+正则 → 只扫真实代码
const sk = stripNoise(s, { keepStrings: true });   // 保留字符串 → 扫关键词/停用词

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
// ⛔ 不许固定字符窗口抠函数：按花括号配对取真实函数体
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

// 1) 题材词提取函数必须存在，且带非题材停用词过滤（业绩/增长/回购等财务事件词不能进板块）
const bReasonThemes = fnBody(sn, 'reasonThemes');
ok('reasonThemes 题材词提取函数存在', bReasonThemes.length > 0);
ok('题材词过滤财务/事件停用词（REASON_STOP）', /REASON_STOP/.test(sn));
ok('题材词过滤含「业绩/增长/回购」等非题材词', /业绩/.test(sk) && /回购/.test(sk));

// 2) 题材词必须先归并到主线口径，绝不允许细分词直接当 sector（否则主线又被拆散）
const bThemeOfSec = fnBody(sn, 'function themeOfSec');
ok('themeOfSec 主线归并函数存在', bThemeOfSec.length > 0);
ok('themeOfSec 与 themeKeyOf 共用同一份 THEME_RULES（不写第二份词表）',
  bThemeOfSec.indexOf('THEME_RULES') >= 0);

// 3) 同花顺题材词统计热度时，也必须先归并到主线（boardStat 里的键是主线不是细分词）
//    定位涨停池归并循环：找到 boardStat 里 themeOfSec 的调用
ok('boardStat 热度统计按主线归并（themeOfSec 出现在 boardStat 构建处）',
  /boardStat\[themeOfSec\(t\)\]/.test(sn) || /boardStat\[tk\]/.test(sn));

// 4) 同花顺题材词分支不套 tooBroad（tooBroad 是过滤央国企改革这类宽泛概念，不用于真实主线）
//    判据：归并循环里 hotRt 的 filter 不能同时出现 tooBroad 和 themeOfSec
const bMerge = fnBody(sn, 'const bySec = {}');
ok('归并循环存在', bMerge.length > 0);
// 同花顺题材分支：hotRt.filter 里只要求 zt>=2，不带 tooBroad
ok('同花顺题材词不套 tooBroad（真实主线不吃 40% 阈值误杀）',
  /hotRt = rts\.filter/.test(sn) && !/hotRt = rts\.filter\([^)]*tooBroad/.test(sn));

// 5) 兜底归并：最终 z.sector 统一过 themeOfSec，把东财"电池/燃气Ⅱ"行业也归到主线
ok('z.sector 兜底归并（东财行业名也归到主线，不拆散）',
  /z\.sector = themeOfSec\(z\.sector\)/.test(sn));

// 6) 细分题材词存 z.themes（供前端展示多题材），不丢信息
ok('细分题材词保留到 z.themes', /z\.themes = rts/.test(sn));

// 7) themeMap 里那条错误地域板块已修正（福建板块→海峡两岸，与注释一致）
ok('themeMap 错误值「福建板块」已修正为「海峡两岸」',
  /'海峡两岸'/.test(sk) && !/'福建板块'\s*[:=]/.test(sk));

console.log('\n题材三源交叉守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
