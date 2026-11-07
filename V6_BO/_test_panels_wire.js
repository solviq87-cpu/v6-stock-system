// 面板联动测试（2026-10-01 用户：「改完后记得验证各个版本之间的联动性」）
//
//  herein 锁两类事故：
//  ① 地域板块混进主线 —— 用户两次点名：「你的主线分析不应该是行业板块吗怎么还有地域」。
//     根因：GEO_BOARD_RE 旧写法要求结尾必须是「板块」，"长江三角/珠三角/京津冀" 全漏网。
//  ② 新面板字段只在 /api/source 里给了，前端读的 /api/state 里没有 → 面板永远空白。
//     （ztPre 就踩了这个：后端扫得出来，前端一块砖都显示不了）
const fs = require('fs');
const path = require('path');

const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// ───────────────── ① 地域板块必须被识别为地域 ─────────────────
console.log('【①】地域板块识别');
const gp = (SV.match(/const GEO_PREFIX = '([^']+)'/) || [])[1] || '';
const gs = (SV.match(/const GEO_SUFFIX = '([^']+)'/) || [])[1] || '';
ok(!!gp && !!gs, 'GEO_PREFIX / GEO_SUFFIX 可解析（勿改回单行正则字面量）');
const GEO = new RegExp('^' + gp + gs + '?$');

const geoNames = ['长江三角', '珠三角', '京津冀', '浙江板块', '上海板块', '成渝特区', '深圳国资', '海南自贸', '雄安新区', '粤港澳'];
const missed = geoNames.filter(n => !GEO.test(n));
ok(missed.length === 0, '地域板块全部命中' + (missed.length ? ' —— 漏网：' + missed.join('、') : ''));

const realNames = ['医药生物', '华为概念', '新能源车', '基础化工', '电池', '半导体', '军工', '汽车零部件'];
const wrongHit = realNames.filter(n => GEO.test(n));
ok(wrongHit.length === 0, '行业/题材板块不被误杀' + (wrongHit.length ? ' —— 误杀：' + wrongHit.join('、') : ''));

// ───────────────── ② 主线计算必须过滤地域 ─────────────────
console.log('\n【②】主线过滤');
const mlBody = (SV.match(/function computeMainline\(\)[\s\S]{0,2500}?\n}/) || [''])[0];
ok(mlBody.length > 200, 'computeMainline 函数体可截取（长度 ' + mlBody.length + '）');
ok(/GEO_BOARD_RE\.test\(/.test(mlBody), 'computeMainline 里对地域板块做了兜底过滤');
ok(/BOARD_BLACKLIST\.indexOf\(/.test(mlBody), 'computeMainline 里同时挡掉泛概念黑名单');
ok(/央国企改革/.test(SV), 'BOARD_BLACKLIST 含"央国企改革"（东财泛概念，不是行业）');

// ───────────────── ③ 前端面板 ← /api/state 字段对齐 ─────────────────
console.log('\n【③】面板字段联动（前端读 state 的字段，服务端必须给）');
const stateBody = (SV.match(/if \(p === '\/api\/state'\)[\s\S]*?\n {2}\}/) || [''])[0];
// 前端面板里出现的 st.xxx（st = /api/state 的返回体）
const used = new Set();
(HTML.match(/\bst\.([A-Za-z_$][\w$]*)/g) || []).forEach(m => used.add(m.slice(3)));
const PANEL_KEYS = ['ztPre', 'ztPreRules', 'trendScan', 'steadyUp', 'trendPool', 'mainline', 'smallyang'];
const missing = PANEL_KEYS.filter(k => !new RegExp('\\b' + k + '\\s*:').test(stateBody));
ok(missing.length === 0, '/api/state 暴露了全部面板字段' + (missing.length ? ' —— 缺：' + missing.join('、') : ''));
const usedMissing = PANEL_KEYS.filter(k => used.has(k)).filter(k => !new RegExp('\\b' + k + '\\s*:').test(stateBody));
ok(usedMissing.length === 0, '前端用到的面板字段在 state 里都有' + (usedMissing.length ? ' —— 缺：' + usedMissing.join('、') : ''));

// 三块新面板容器必须在前端存在
['ztPreBox', 'trendScanBox', 'steadyUpBox'].forEach(id => {
  ok(HTML.indexOf(id) >= 0, '前端存在面板容器 ' + id);
});

// ───────────────── ④ 涨停前形态：扫描结果要能进推送/面板 ─────────────────
console.log('\n【④】涨停前形态（ztpre）接线');
ok(/require\('\.\/ztpre'\)/.test(SV), 'server.js 已引入 ztpre 模块');
ok(/S\.ztPre = /.test(SV) || /S\.ztPre=/.test(SV), '扫描结果写回 S.ztPre（面板才拿得到）');
ok(/ztpre\.js/.test(fs.readFileSync(path.join(__dirname, '_publish.py'), 'utf8')), '_publish.py 的 CODE_FILES 含 ztpre.js');
ok(/ztpre\.json/.test(fs.readFileSync(path.join(__dirname, '_publish.py'), 'utf8')), '_publish.py 的 DATA_FILES 含 ztpre.json');
// 启动链：不能只挂定时器（已犯三次的坑——computeBreadth / klineBackfill / scanTrendUniverse）
const callSites = (SV.match(/scanZtPre\(/g) || []).length;
ok(callSites >= 3, 'scanZtPre 有 ' + callSites + ' 处调用（定时 + 启动首扫 + 手动接口，应 ≥3）');
// 启动链：不能只挂定时器（已犯三次的坑——computeBreadth / klineBackfill / scanTrendUniverse）
// ⚠️ 2026-10-02 改过形状：原来是「固定延迟 10 分钟」，线上实例被平台回收后冷启动 →
//    前 10 分钟面板全是 0（实测冷启动 15 分钟后 ztPreProg.scanned 仍为 0）。
//    现在改成「就绪即扫」：20 秒先试一次 + 之后每 10 秒探到学习库就绪就扫。
//    断言随之升级：不认死旧函数名，但必须满足「60 秒内肯定动手，且三条扫描都在里面」。
ok(/const _bootScan[\s\S]{0,4000}scanTrendUniverse\(30\)[\s\S]{0,2000}scanSteadyUp\(12\)[\s\S]{0,2000}scanZtPre\(20\)/.test(SV),
  '启动首扫链里三条扫描齐全（趋势 / 连涨 / 涨停前），不是只挂 30 分钟定时器');
ok(/setTimeout\([\s\S]{0,80}_bootScan\(\)[\s\S]{0,40}\}, 20000\)/.test(SV),
  '启动 20 秒就先试一次（冷启动不再空等 10 分钟）');
ok(/setInterval\([\s\S]{0,400}\}, 10000\)/.test(SV),
  '并有 10 秒一次的就绪轮询兜底（学习库加载慢也不会漏扫）');
ok(!/10 \* 60 \* 1000\);\s*$/m.test(SV.slice(SV.indexOf('const _bootScan'), SV.indexOf('const _bootScan') + 4000)),
  '启动首扫不再是「固定延迟 10 分钟」那种写法');

console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
process.exit(fail ? 1 : 0);
