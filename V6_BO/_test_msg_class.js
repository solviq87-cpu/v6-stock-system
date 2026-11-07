// 推送「分类额度」守门测试（2026-10-06 漏洞体检）
// 背景：条数闸门按标题正则分类，未命中的一律落进「其它」，而其它每天只有【1 条】额度。
// 实测踩到的坑：
//   ① 全市场趋势扫描 / 连续收涨 / 涨停前形态 三个标题**都不匹配任何分类** → 共用那 1 条额度，
//      一天只能发出去第一条，后两条天天被静默拦下（面板流水里才看得到"条数闸门"）。
//   ② 开盘自检（每天必发的报平安）也在「其它」里，它一发出，当天的持仓提醒/利好推送全被挤掉。
//   ③ 「全A股学习」写死四字连写，实际标题是「全A股走势学习」→ 没命中。
// 统计口径：只认 pushAll / pushWecom（真正外发）；pushLog 仅写面板流水，不过闸门，不算。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const capM = s.match(/const MSG_CAP = \{([^}]+)\}/);
const freeM = s.match(/const MSG_FREE_RE = \/(.+?)\//);
const typeM = s.match(/const MSG_TYPE_RE = \[([\s\S]*?)\n\];/);
ok('能解析出 MSG_CAP / MSG_FREE_RE / MSG_TYPE_RE', !!(capM && freeM && typeM));

const CAP = {};
for (const kv of (capM ? capM[1] : '').split(',')) {
  const [k, v] = kv.split(':');
  if (k && v) CAP[k.trim().replace(/'/g, '')] = +v.trim();
}
const FREE = new RegExp(freeM ? freeM[1] : '(?!)');
const TYPES = [];
for (const m of (typeM ? typeM[1] : '').matchAll(/\[\/(.+?)\/,\s*'(.+?)'\]/g)) TYPES.push([new RegExp(m[1]), m[2]]);

// 1) 三类必须各有各的额度，不再挤在「其它」
ok('MSG_CAP 含 趋势 类', CAP['趋势'] != null && CAP['趋势'] >= 3);
ok('MSG_CAP 含 持仓 类', CAP['持仓'] != null && CAP['持仓'] >= 2);
ok('MSG_CAP 含 消息 类', CAP['消息'] != null);
ok('MSG_CAP 含 外围 类', CAP['外围'] != null);
ok('MSG_TYPE_RE 能认出趋势三推', TYPES.some(([re, k]) => k === '趋势' && /全市场趋势扫描|连续收涨|涨停前形态/.test(re.source)));
ok('MSG_TYPE_RE 能认出持仓盯盘/加减仓', TYPES.some(([re, k]) => k === '持仓' && /持仓盯盘|加减仓风险/.test(re.source)));

// 2) 必达类进免闸
ok('免闸含开盘自检', FREE.test('📡 开盘自检 · 2026-10-06'));
ok('免闸含持仓已清空', FREE.test('🗑 持仓已清空'));
ok('免闸含全A股走势学习（不再因"走势"二字漏掉）', FREE.test('🧠 全A股走势学习'));

// 3) ⛔ 真正外发的标题里，不允许有落进「其它」的（其它每天仅 1 条，等于隐形漏斗）
const rows = [];
for (const f of ['server.js', 'holdings.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/push(?:All|Wecom)\(\s*([^)]{0,400})/g)) {
    const tm = m[1].match(/═══\s*([^\n\\`]{2,40}?)\s*(?:═|$|\\n|`|\$\{)/);
    if (!tm) continue;
    const t = tm[1].trim();
    if (!t || t.includes('$') || t.length < 3) continue;
    let kind = '其它';
    if (FREE.test(t)) kind = '日报(免闸)';
    else for (const [re, k] of TYPES) { if (re.test(t)) { kind = k; break; } }
    rows.push({ kind, t });
  }
}
const bad = [...new Map(rows.map(r => [r.t, r])).values()].filter(r => r.kind === '其它');
ok('外发推送无一条落进「其它」类（' + rows.length + ' 个标题）', bad.length === 0, bad.map(r => r.t).join(' | '));
if (bad.length) bad.forEach(r => console.log('     └ 漏网：' + r.t));

// 4) 趋势三推：放宽窗口 + 每天只推一次（放宽窗口后没有标记就会每半小时重复刷）
ok('趋势三推窗口放宽到 24*60', /t >= 15 \* 60 \+ 45 && t < 24 \* 60/.test(s)
  && /t >= 15 \* 60 \+ 50 && t < 24 \* 60/.test(s) && /t >= 15 \* 60 \+ 55 && t < 24 \* 60/.test(s));
// ⚠️ 2026-10-08 改判据：闭锁收口成 sentToday(...)，不再钉 `xxxScanDate !== ds` 旧字面量
ok('趋势三推各有"今天已推"标记', /sentToday\(tsScanDate, ds,/.test(s) && /sentToday\(suScanDate, ds,/.test(s) && /sentToday\(zpScanDate, ds,/.test(s));
ok('趋势三推先发后标记', /pushTrendScan\(\); tsScanDate = ds;/.test(s));

const buf = fs.readFileSync(path.join(ROOT, 'server.js'));
ok('server.js 保持 LF（无 CRLF）', buf.indexOf(Buffer.from('\r\n')) === -1);

console.log(`\n推送分类额度守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
