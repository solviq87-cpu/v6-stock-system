// 守门测试：后端 /api/state 下发的字段 ↔ 前端实际读取的字段，不许分叉（2026-10-07，本轮新角度）
//
// 本轮盯的是「同一个概念在两端对不上」。这类 bug 的特征是**不报错、不崩、测试不红**：
// 前端读一个后端没发的键，拿到的是 undefined，页面照常渲染，只是那个数永远是 0 或空白。
//
// 实测抓到的：
//   ① 前端「全市场趋势扫描」标题行读 `s.learnall.n`，而 /api/state **从来没下发过 learnall**
//      → 面板永远显示「学习库 0 条样本」。用户看着会以为模型没学，其实学了几万条。
//      同一个概念后端叫 zpDb().n / learn.samples，前端叫 learnall.n，各叫各的。
//   ② `feishuMask: feishuMask()` 在同一个对象字面量里连写了**三遍**（后写的覆盖先写的，
//      值一样所以看不出问题，但改一处漏两处时会出现「改了没生效」）。
//   ③ 同一个概念「全市场扫描进度」：涨停前形态区块接了 ztPreProg，趋势扫描区块却没接
//      trendScanProg（后端一直有发）→ 同样是全市场扫描，一个显示进度一个不显示。
//   ④ pushGov / ztTopicSrc 后端算了、注释也写着"给面板看"，前端一次都没读 → 白算。
//
// 钉死四条：前端读的键后端必须发（白名单除外）／顶层键不许重复／
// 对称的进度字段必须都被读到／同一份状态不许在两个接口各拼一份。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 剥注释：本项目注释里会逐字引用旧代码（含 s.xxx 这种），不剥必假红
function stripComments(src) {
  return src.split('\n').map(line => {
    let from = 0;
    for (;;) {
      const i = line.indexOf('//', from);
      if (i < 0) return line;
      if (line[i - 1] === ':') { from = i + 2; continue; }
      const q = (line.slice(0, i).match(/'/g) || []).length;
      if (q % 2 === 1) { from = i + 2; continue; }
      return line.slice(0, i);
    }
  }).join('\n');
}

// ── 抠 /api/state 的 payload 顶层键（按括号深度，不能按行首缩进：同一行会写两个键）──
function payloadKeys() {
  const anchor = SV.indexOf("if (p === '/api/state') {");
  const rel = SV.slice(anchor, anchor + 40000);
  const jStart = rel.indexOf('return json(res, {');
  const bStart = rel.indexOf('{', jStart);
  let d = 0, jEnd = -1;
  for (let i = bStart; i < rel.length; i++) {
    if (rel[i] === '{') d++;
    else if (rel[i] === '}') { d--; if (d === 0) { jEnd = i; break; } }
  }
  // ⛔ 必须先剥注释：payload 里有大量行尾注释（`ztTopics: …, // 涨停题材热度`），
  //    不剥的话下一条的键名会变成 "//涨停题材热度ztTopicSrc"，键数直接对不上。
  const block = stripComments(rel.slice(bStart, jEnd + 1));
  const keys = [];
  let depth = 0, seg = '', inStr = null;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i], prev = i > 0 ? block[i - 1] : '';
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; seg += ch; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; seg += ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if ((ch === '}' || ch === ')' || ch === ']') && depth === 1 && i === block.length - 1) {
      // 收尾：最后一个条目
    }
    if ((ch === '}' || ch === ')' || ch === ']')) depth--;
    if (depth === 1 && ch === ',') {
      const k = seg.split(':')[0].replace(/[\s'"`]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.push(k);
      seg = ''; continue;
    }
    if (depth >= 1) seg += ch;
  }
  // 最后一个条目（收尾的 } 前）
  const k = seg.split(':')[0].replace(/[\s'"`]/g, '');
  if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.push(k);
  return keys;
}
const KEYS = payloadKeys();
const UNIQ = [...new Set(KEYS)];

const scriptOnly = stripComments(HTML.slice(HTML.indexOf('<script'), HTML.lastIndexOf('</script>')));
const reads = new Set();
let mm; const RE = /\bs\.([A-Za-z_$][\w$]*)/g;
while ((mm = RE.exec(scriptOnly))) {
  // ⛔ 2026-10-28 补：`s.indexOf(…)` / `s.slice()` 这类是**局部字符串变量的方法调用**，
  //    不是 /api/state 的字段读取（发布看板阶段标签里就有 `const s = …; s.indexOf('published-')`）。
  //    旧扫描器一律当字段收 → 判「前端读了后端没发」假红。判据：后面紧跟 `(` 的是方法调用，跳过。
  const after = scriptOnly.slice(mm.index + mm[0].length);
  if (/^\s*\(/.test(after)) continue;
  reads.add(mm[1]);
}

group('[0] 先确认这套检查真的扫到了东西（空转的守门等于没有）');
{
  ok('抠到 /api/state 顶层键 ' + UNIQ.length + ' 个', UNIQ.length >= 40, UNIQ.slice(0, 5).join(','));
  ok('且确实包含 pool / trendScan / pushGov',
    UNIQ.includes('pool') && UNIQ.includes('trendScan') && UNIQ.includes('pushGov'));
  ok('扫到前端 s.xxx 读取 ' + reads.size + ' 个', reads.size >= 40);
}

group('[1] ⛔ 前端读了但 payload 顶层没有的键（= 静默 undefined）');
{
  // 白名单：这些 `s` 不是 /api/state 那个对象（局部循环变量、别的接口回包、DOM 元素）
  // locked / needPassword / reason / msg 是门禁在令牌失效时**抢在 /api/state 之前**返回的，
  // 所以不在 payload 里 —— 它们只在 s.locked 那一支里被读，正常响应下是 undefined（有 || 兜底）。
  // ⛔ 2026-10-07 补：co 轮让门禁把失败原因分开下发给前端，msg / reason 由此进入白名单。
  const NOT_STATE = new Set(['id', 'nd', 'textContent', 'ok', 'error', 'length', 'name',
    'locked', 'needPassword', 'reason', 'msg']);
  const bad = [...reads].filter(k => !UNIQ.includes(k) && !NOT_STATE.has(k));
  ok('⛔ 除白名单外没有读不到的键', bad.length === 0, bad.join(', '));
  // 交叉校验：白名单里这几个键，后端门禁必须真的会发（否则就是单纯的读了个不存在的东西）
  ok('⛔ locked / needPassword 确实由门禁返回（不是前端凭空读的）',
    /json\(res,\s*\{\s*locked:\s*true,\s*needPassword:\s*true/.test(SV));
  ok('⛔ reason / msg 确实由门禁返回（失败原因要能传到前端，不许前端自己猜）',
    /reason:\s*_why\s*\|\|\s*'none'/.test(SV) && /msg:\s*tokenRejectMsg\(_why\)/.test(SV));
  // 逐点钉死本轮修的那一个
  ok('⛔ learnall 确实在 payload 里（前端一直在读 s.learnall.n）', UNIQ.includes('learnall'));
  ok('⛔ 且后端是拿 ztpre 学习库的样本数喂它', /learnall:\s*\{\s*n:\s*\(zpDb\(\)\s*\|\|\s*\{\}\)\.n/.test(SV));
  // 反证
  ok('反证：payload 里没这个键时应当判不合格',
    !UNIQ.includes('一个根本不存在的键'));
}

group('[2] ⛔ 同一个对象字面量里不许重复声明同一个键');
{
  const dup = [...new Set(KEYS.filter((k, i) => KEYS.indexOf(k) !== i))];
  ok('⛔ /api/state 顶层键无重复（共 ' + KEYS.length + ' 处声明）', dup.length === 0, dup.join(', '));
  // 本轮修的 feishuMask 曾经连写三遍
  ok('⛔ feishuMask 只声明一次', KEYS.filter(k => k === 'feishuMask').length === 1);
  ok('⛔ 且注释里写明了为什么不能重复写', /重复键是纯死代码/.test(SV));
  // 反证
  ok('反证：写两遍的旧写法应当判不合格',
    (() => { const a = ['x', 'x']; return a.filter((k, i) => a.indexOf(k) !== i).length > 0; })());
}

group('[3] ⛔ 同一个概念的两个实例必须对称接到前端（扫描进度）');
{
  ok('⛔ 后端两个全市场扫描都有进度：ztPreProg 与 trendScanProg',
    UNIQ.includes('ztPreProg') && UNIQ.includes('trendScanProg'));
  ok('⛔ 前端两个区块都读到了进度（不是一个显示一个不显示）',
    /s\.ztPreProg/.test(scriptOnly) && /s\.trendScanProg/.test(scriptOnly));
  // ⛔ 2026-10-07 修：原来钉的是 `(s.ztPreProg || {}).scanned` 这种**具体写法**，
  //    而 cu 轮为了加"本轮未跑成"提示，把进度对象提成了局部变量（`const zpg = s.ztPreProg || {}`）
  //    → 字面量对不上就假红，可两边读的明明还是同一套字段。判据改成钉**语义**：
  //    两个区块各自都读了 scanned 与 total（不管经由哪个变量）。
  const _readsScan = (varRe) => {
    const m = scriptOnly.match(varRe);
    if (!m) return false;
    // 从变量声明处往后 600 字符内，必须出现 .scanned 与 .total
    const seg = scriptOnly.slice(m.index, m.index + 600);
    return /\.scanned/.test(seg) && /\.total/.test(seg);
  };
  ok('⛔ 且读的是同一套字段（scanned / total）',
    _readsScan(/const zpg = s\.ztPreProg/) && _readsScan(/const _tsp = s\.trendScanProg/));
  // 反证
  ok('反证：只接一边的旧写法应当判不合格',
    !/s\.trendScanProg/.test("const a = (s.ztPreProg || {}).scanned;"));
}

group('[4] ⛔ 同一份状态不许在两个接口里各拼一份');
{
  ok('⛔ 抽出了唯一的 pushGovStat()', /function pushGovStat\(\)/.test(SV));
  ok('⛔ /api/state 用它', /pushGov:\s*pushGovStat\(\)/.test(SV));
  ok('⛔ /api/push-log 也用它（不是再抄一份）', /gov:\s*pushGovStat\(\)/.test(SV));
  ok('⛔ 全项目只有一处拼这个对象（没有第二份 quota/unlimited/msgs）',
    (SV.match(/unlimited:\s*q === Infinity/g) || []).length === 1);
  // 反证：两处各拼一份
  ok('反证：两处各拼一份应当判不合格',
    (("quota:1,unlimited:true" + "quota:1,unlimited:true").match(/unlimited/g) || []).length > 1);
}

group('[5] 后端算了却没人用的键（已知清单，不许悄悄变多）');
{
  const unused = UNIQ.filter(k => !new RegExp('\\.' + k + '\\b').test(scriptOnly));
  // pushGov：面板走的是 /api/push-log 的 r.gov（同一份 pushGovStat），不读 s.pushGov，属已接线
  // modDay：模块日额度，后端保留供排障，暂未上面板
  // yier / lianban：连板接力数据，只读不可见，暂未上面板（走私密推送）
  // 主因：lp 轮的情绪卡主线 Top3（digest.mainline3）只喂手机速览，桌面面板不显示；
  //   后端算它是为了让速览页少一次专题请求，属"已知未上桌面"的键。
  // nameClans：nz 轮字辈补涨同款——mobile.html:622 速览字辈卡已消费，桌面未上（已知未上桌面）。
  const KNOWN = new Set(['modDay', 'pushGov', 'yier', 'lianban', 'mainline3', 'nameClans']);
  const unexpected = unused.filter(k => !KNOWN.has(k));
  ok('⛔ 未接线的键不超过已知清单（当前 ' + unused.length + ' 个：' + unused.join(',') + '）',
    unexpected.length === 0, unexpected.join(', '));
  ok('⛔ pushGov 已接到「推送流水」弹窗（r.gov）', /r\.gov/.test(scriptOnly));
  ok('⛔ ztTopicSrc 已接到题材行（来源可追溯）', /s\.ztTopicSrc/.test(scriptOnly));
}

group('[6] 判据本身没被绕过');
{
  ok('⛔ /api/state 仍然只有一处（另有 SSE 精简版，加错位置前端照样拿不到）',
    (SV.match(/p === '\/api\/state'/g) || []).length === 1);
  ok('⛔ 扫描器用的仍是剥注释后的前端源码', /stripComments\(HTML/.test(fs.readFileSync(path.join(ROOT, '_test_state_field_parity.js'), 'utf8')));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
