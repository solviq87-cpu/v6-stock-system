// 板块效应口径守门（2026-10-09 en 轮）
// 起因：用户质疑「一进二不是应该竞价推送吗你现在给我看啥意思」，顺着查 S.ztBySector 消费口径，
//       在 analyzePreBuy（模拟盘买入前的独立分析）里挖到一个**完全静默**的失效 bug。
//
// ⛔ 原代码两处叠加错误，导致 secZT 恒为 0、「板块效应 +8/+4 分」从来没进过打分：
//     ① sectorOfStock(c.code) —— 形参是【股票对象】（内部读 stock.code），这里却传字符串 code，
//        于是 stock.code = undefined → 涨停池那层 find 永远查不到 → 直接跌到最后的"未知"兜底；
//     ② S.ztBySector[sec.name] —— sectorOfStock 返回的是【字符串】板块名，字符串取 .name = undefined
//        → S.ztBySector[undefined] → [] → 0。
//    不报错、不算错，只是一个维度长期缺席 —— 本项目最典型的 bug 形态。
//
// 同类第二处：板块异动选股拿东财 BK 涨幅榜名（"固态电池BK0968"）直接查 S.ztBySector
//   （键是主线归并口径"电池·储能"），两套命名对不上 → 同样恒 0。
//
// ⛔ 判代码一律用剥注释版本（我在修复注释里逐字引用了旧写法 sectorOfStock(c.code) / sec.name）。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const s = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const sn = stripNoise(s);
const skr = stripNoise(s, { keepStrings: true }); // 保留字符串：判「未知」这类字面量常量必须用这个
                                                  // （stripNoise 默认连字符串一起抹，踩过）

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

const bAPB = fnBody(skr, 'function analyzePreBuy');
const bSOS = fnBody(skr, 'function sectorOfStock');

// 1) 传参：必须传对象 {code, name}，绝不许再传裸字符串 code
ok('analyzePreBuy 传对象给 sectorOfStock（不是裸 code 字符串）',
  /sectorOfStock\(\{\s*code:\s*c\s*\.\s*code/.test(bAPB) &&
  !/sectorOfStock\(\s*c\s*\.\s*code\s*\)/.test(bAPB));

// 2) 取值：sectorOfStock 返回字符串，不许再把它当对象取 .name
ok('不再对 sectorOfStock 返回值取 .name（返回的是字符串）',
  !/S\s*\.\s*ztBySector\[\s*sec\s*\.\s*name\s*\]/.test(sn));

// 3) 兜底值："未知"不是板块名，拿它查表等于白查 —— 查表前必须排除
ok('查表前排除「未知」兜底值（未知不是板块名）',
  /sec\s*!==\s*'未知'/.test(bAPB) || /sec\s*!==\s*"未知"/.test(bAPB));

// 4) 第二处：东财 BK 榜名查表前过 themeOfSec 归并主线（两套命名不能直接互查）
ok('板块异动选股：BK 榜名先 themeOfSec 归并再查表',
  /themeOfSec\(\s*sg\s*\.\s*name\s*\)/.test(sn) &&
  !/S\s*\.\s*ztBySector\[\s*sg\s*\.\s*name\s*\]/.test(sn));

// 5) 契约钉子：sectorOfStock 必须返回字符串（防止将来有人改成返回对象却忘了同步 20 处调用方）
ok('sectorOfStock 返回字符串（调用方依赖此契约）',
  /return\s+zt\s*\.\s*sector\s*;/.test(bSOS) && /return\s+'未知'\s*;/.test(bSOS));

// 6) 反证：修复后 secZT 参与打分是有条件的（>=3 加8分 / >=1 加4分），不能退化为常量 0
ok('板块效应加分仍然生效（secZT 参与打分，未删.subst）',
  /secZT\s*>=\s*3/.test(bAPB) && /secZT\s*>=\s*1/.test(bAPB));

// 7) 整条边界钉契约（en 轮之后延伸）：sectorHeat 收【字符串】板块名，调用方传的是
//    sectorOfStock(s) 返回的字符串，杜绝「把股票对象当板块名传给 heat」的同类静默错位
ok('sectorHeat 收字符串板块名（调用方传 sectorOfStock(s) 返回值）',
  /sectorHeat\(\s*sectorOfStock\(/.test(sn));

// 8) boardsOf 收【code 字符串】，调用方传 .code，不收股票对象（收对象会读 .code 拿到 undefined 静默落空）
ok('boardsOf 收 code 字符串（调用方传 .code，不传股票对象）',
  /boardsOf\(\s*z\s*\.\s*code\s*\)/.test(sn) && /boardsOf\(\s*stock\s*\.\s*code\s*\)/.test(sn));

// 9) 反证：返回字符串的函数绝不许被调用方当对象取 .name —— 全文件扫 sectorOfStock/themeOfSec/themeKeyOf
//    三个已知字符串返回函数，确认没有 `X(...).name` 这种写法（钉住整条边界的返回类型契约）
ok('字符串返回函数不被当对象取 .name（sectorOfStock/themeOfSec/themeKeyOf 三处）',
  !/\bsectorOfStock\([^)]*\)\s*\.\s*name\b/.test(sn) &&
  !/\bthemeOfSec\([^)]*\)\s*\.\s*name\b/.test(sn) &&
  !/\bthemeKeyOf\([^)]*\)\s*\.\s*name\b/.test(sn));

console.log('\n板块效应口径守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
