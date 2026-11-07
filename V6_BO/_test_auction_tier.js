// 守门：竞价异动「连板梯队」归并（fp 轮 / 2026-10-09）
//
// 用户原话：「一进二二进三是板位分层，不是涨停一个推一个」——旧的竞价异动每 tick 平铺最多3只、
// 无板位信息，看着像逐只播报。修复：抽 auctionBoardTier(lb) 把昨日板位归并到
// 一进二/二进三/三进四/高板/首板冲刺，竞价推送按梯队分组。
//
// 同时钉死一进二/二进三候选池的板位分层契约（它们本来就对，守门防回归）：
//   scanYiEr        → 只取 limitUpCount===1（首板→二板）
//   scanLianbanRelay→ 只取 level 2/3（二板→三板 / 三板→四板）
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/server.js', 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 抽函数体（花括号配对，不靠固定行号）
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ---------- 1. auctionBoardTier 行为（抽出来真跑）----------
let tierFn;
try { tierFn = new Function('return ' + extractFn(SRC, 'auctionBoardTier'))(); }
catch (e) { console.log('  ✗ 抽取 auctionBoardTier 失败: ' + e.message); fail++; }

if (tierFn) {
  const cases = [
    [undefined, 'fresh', '首板冲刺'],
    [0, 'fresh', '首板冲刺'],
    [1, 'yier', '一进二'],
    [2, 'er', '二进三'],
    [3, 'san', '三进四'],
    [4, 'high', '高板'],
    [9, 'high', '高板'],
  ];
  for (const [lb, key, labelHas] of cases) {
    const t = tierFn(lb);
    ok(`auctionBoardTier(${lb}) → key=${key}`, t && t.key === key);
    ok(`auctionBoardTier(${lb}) → 文案含「${labelHas}」`, t && t.label.indexOf(labelHas) >= 0);
  }
  // 高板文案必须体现「n板→n+1板」递进
  ok('高板文案体现板位递进', tierFn(5).label.indexOf('5板→6板') >= 0);
}

// ---------- 2. 竞价异动块确实接了梯队归并（不是平铺）----------
// ⛔ 铁律④：不许用「锚点 ± 固定字符窗口」切源码段。旧写法（今天早些时候改过一次）用两条正则
//    剥注释 + 锚点前后 ±600/400 字符：
//    ① `/\/\*[\s\S]*?\*\//g` 会被本项目超长版本注释里的 `/*` 字样配到几百行之后的 `*/`，
//       把中间的真代码整段吞掉（实测竞价块就在被吞的范围里）；
//    ② 锚点即使剥干净了，窗口仍是固定字符数 —— 块一改长就切出边界 → 必假红。
//    现按**语义边界**取块：从纯函数定义取到该块的收尾调用，标题则钉在**代码模板字符串**上。
ok(/let msg = `═══ 🔥 竞价异动 · 连板梯队扫描/.test(SRC), '竞价异动标题改为「连板梯队扫描」');
const iTier = SRC.indexOf('function auctionBoardTier(lb) {');
const iTierEnd = SRC.indexOf('auctionFrontRunNote(', iTier);
const tierBlock = (iTier >= 0 && iTierEnd > iTier) ? SRC.slice(iTier, iTierEnd) : '';
ok('取到竞价板位归并块（语义边界，非固定窗口）', tierBlock.length > 200, '长度 ' + tierBlock.length);
ok('竞价块调用 auctionBoardTier 归并板位', /auctionBoardTier\(/.test(tierBlock));
ok('竞价块按梯队分组（groups + _order 遍历）', /groups\[/.test(tierBlock) && /for \(const k of _order\)/.test(tierBlock));
ok('竞价块板位取昨日涨停池 limitUpCount', /S\.ztPool[\s\S]{0,200}?\.find\(z => z\.code === x\.code\)/.test(tierBlock));

// ---------- 3. 一进二候选池 = 首板（limitUpCount===1）----------
const yi = extractFn(SRC, 'scanYiEr');
ok('scanYiEr 只取首板 (limitUpCount||1)===1', /\(z\.limitUpCount \|\| 1\) === 1/.test(yi));

// ---------- 4. 二进三/三进四候选池 = 二板/三板（level 2,3）----------
const lb = extractFn(SRC, 'scanLianbanRelay');
ok('scanLianbanRelay 按 level [2,3] 分层', /for \(const level of \[2, 3\]\)/.test(lb) && /\(z\.limitUpCount \|\| 1\) === level/.test(lb));

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
