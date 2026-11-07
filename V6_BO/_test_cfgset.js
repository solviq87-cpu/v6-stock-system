// 守门测试（df 轮 · 角度：承诺了但没有任何一条路径会去兑现）
//   系统里有几处明写着「嫌吵可在面板关掉」（9:20 竞价预览）、
//   「请检查面板的静默时段设置」（推送自检诊断）、「可配 config.viewIdleHours」——
//   但 public/index.html 里**一个入口都没有**，/api/config 也只认 CFG_RANGE 那 11 个数字键
//   （不在表里 → 连 _cfgIn 都进不去 → 不报错、不落盘，接口照样回 ok:true），
//   全项目连一个写入点都找不到。用户要么永远关不掉，要么只能手改 config.json 再重启，
//   而那句提示并没有告诉他。这类故障不报错、不崩溃、面板照常显示 —— 只是那句话是空的。
//   现在这些键统一登记进 CFG_SET：读取走 cfgSetOf，写入走 cfgSetErrors 先体检再落盘，
//   面板由 /api/state 的 cfgSet 渲染（名称与说明由兑现方产出，面板不另抄一份）。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → ' + got : '')); }
};
const sec = t => console.log('\n' + t);

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });
const HTML = fs.readFileSync('./public/index.html', 'utf8');
// ⛔ 扫面板字面量必须剔除 APP_VER 那行版本说明（它会逐字引用本轮要消灭的旧字面量）
const HTMLX = HTML.split('\n').filter(l => !l.startsWith('const APP_VER = ')).join('\n');
const slice = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + a);
  return SRC.slice(i, j);
};

// ── ① CFG_SET 表本身：每个键都必须自带「面板上怎么说」 ────────────────
sec('【① 开关表：登记项必须自带 label / note / 缺省值】');
const SET_SRC = slice('const CFG_SET = {', 'const PUSH_GOV_RESERVE');
ok('[自检] 切到 CFG_SET 定义段', /const CFG_SET = \{/.test(SET_SRC) && /function cfgSetOf/.test(SET_SRC) && /function cfgSetErrors/.test(SET_SRC) && /function cfgSetState/.test(SET_SRC));
// ⛔ 沙箱注入清单：cfgSetOf 读的是全局 S —— 漏装会让整段崩掉而不是变红（同类坑已踩 12 次）
const mkSet = cfg => new Function('S', SET_SRC + '\nreturn { CFG_SET, cfgSetOf, cfgSetErrors, cfgSetState };')(cfg);
const E = mkSet({ config: {} });
const keys = Object.keys(E.CFG_SET);
ok('登记项不少于 4 个（竞价预览 / 静默起止 / 只读闲置）', keys.length >= 4, keys.join(','));
for (const k of keys) {
  const d = E.CFG_SET[k];
  ok(`  ${k} 自带 kind / def / label / note`, !!d.kind && d.def !== undefined && !!d.label && !!d.note, `${d.kind}/${JSON.stringify(d.def)}/${d.label}`);
}
ok('四个曾经的"空头承诺"键都在表里',
  ['auctionPreview', 'quietStart', 'quietEnd', 'viewIdleHours'].every(k => keys.includes(k)), keys.join(','));

// ── ② 沙箱真跑 cfgSetOf：没设过 → 缺省值；设坏了 → 也退回缺省值 ──────────
sec('【② 唯一读取入口 cfgSetOf：缺省与坏值的行为】');
ok('未配置时 auctionPreview = 缺省 true（默认发竞价预览）', E.cfgSetOf('auctionPreview') === true);
ok('未配置时 quietStart = 缺省 "00:30"', E.cfgSetOf('quietStart') === '00:30', E.cfgSetOf('quietStart'));
ok('未配置时 quietEnd = 缺省 "08:30"', E.cfgSetOf('quietEnd') === '08:30', E.cfgSetOf('quietEnd'));
ok('未配置时 viewIdleHours = 缺省 24', E.cfgSetOf('viewIdleHours') === 24, E.cfgSetOf('viewIdleHours'));

const S1 = mkSet({ config: { auctionPreview: false } });
ok('auctionPreview=false → 关掉（这条路径以前根本不存在）', S1.cfgSetOf('auctionPreview') === false);
ok('auctionPreview="false" 字符串也认（面板表单会这么传）', mkSet({ config: { auctionPreview: 'false' } }).cfgSetOf('auctionPreview') === false);
ok('auctionPreview 设成垃圾值 → 退回缺省 true，绝不静默按"关"处理',
  mkSet({ config: { auctionPreview: 'yes' } }).cfgSetOf('auctionPreview') === true);
ok('quietStart="23:00" 生效', mkSet({ config: { quietStart: '23:00' } }).cfgSetOf('quietStart') === '23:00');
ok('quietStart="25:00" 这种不存在的时刻 → 退回缺省',
  mkSet({ config: { quietStart: '25:00' } }).cfgSetOf('quietStart') === '00:30');
ok('quietStart="8点" 格式不对 → 退回缺省', mkSet({ config: { quietStart: '8点' } }).cfgSetOf('quietStart') === '00:30');
ok('viewIdleHours=48 生效', mkSet({ config: { viewIdleHours: 48 } }).cfgSetOf('viewIdleHours') === 48);
ok('viewIdleHours=0 原样读出（"按缺省 24 走"由使用端 viewIdleMs 解释）',
  mkSet({ config: { viewIdleHours: 0 } }).cfgSetOf('viewIdleHours') === 0);
ok('⛔ config.json 里躺着 9999 时读取端也要兜住上界（老文件写入端拦不住）',
  mkSet({ config: { viewIdleHours: 9999 } }).cfgSetOf('viewIdleHours') === 720,
  mkSet({ config: { viewIdleHours: 9999 } }).cfgSetOf('viewIdleHours'));

// ── ③ 沙箱真跑 cfgSetErrors：格式错必须报错 ────────────────────────────
sec('【③ 写入端体检 cfgSetErrors：坏值必须拦下并说清原因】');
const err = o => E.cfgSetErrors(o);
ok('bool 传 true / false 都合法', err({ auctionPreview: true }).length === 0 && err({ auctionPreview: false }).length === 0);
ok('bool 传 "true" / "false" 字符串也合法（表单常见）', err({ auctionPreview: 'true' }).length === 0 && err({ auctionPreview: 'false' }).length === 0);
ok('⛔ bool 传 "yes" 被拦下', err({ auctionPreview: 'yes' }).length === 1, err({ auctionPreview: 'yes' })[0]);
ok('hhmm 传 "23:00" 合法', err({ quietStart: '23:00' }).length === 0);
ok('⛔ hhmm 传 "25:00" 被拦下', err({ quietStart: '25:00' }).length === 1, err({ quietStart: '25:00' })[0]);
ok('⛔ hhmm 传 "0800"（缺冒号）被拦下', err({ quietEnd: '0800' }).length === 1);
ok('⛔ hhmm 传 "8:5"（分钟要两位）被拦下', err({ quietEnd: '8:5' }).length === 1);
ok('int 传 48 合法', err({ viewIdleHours: 48 }).length === 0);
ok('int 传 0 合法（0 交给使用端解释，不被当成"没提交"）', err({ viewIdleHours: 0 }).length === 0);
ok('⛔ int 传 721 超出上界被拦下', err({ viewIdleHours: 721 }).length === 1, err({ viewIdleHours: 721 })[0]);
ok('⛔ int 传 "abc" 被拦下', err({ viewIdleHours: 'abc' }).length === 1);
ok('不在表里的键不归它管（交给 CFG_RANGE 段落）', err({ probThreshold: 0.8 }).length === 0);

// ── ④ 反证：旧路径下这四个键会被接口静默丢弃 ──────────────────────────
sec('【④ 反证：为什么以前改不了（接口静默丢弃，还回 ok:true）】');
// ⛔ dg 轮：CFG_RANGE 已前移到回滚段之前（修 TDZ），再用「CFG_RANGE → CFG_SET」当窗口
//    会把中间两千多行顶层代码一起切进来（含回滚段）→ 沙箱里 S 未定义，整个套件崩掉。
const RANGE_SRC = slice('const CFG_RANGE = {', '// 返回人类可读的错误列表');
const RANGE = new Function(RANGE_SRC + '\nreturn CFG_RANGE;')();
for (const k of ['auctionPreview', 'quietStart', 'quietEnd', 'viewIdleHours']) {
  ok(`  旧白名单 CFG_RANGE 里没有 ${k}（提交它会被整段跳过、不报错）`, !Object.keys(RANGE).includes(k));
}
ok('  两者键集合不相交（数字键归 CFG_RANGE，开关/时段归 CFG_SET）',
  Object.keys(RANGE).every(k => !keys.includes(k)));

// ── ⑤ 源码：实现必须走单一出口，不许再裸读 S.config ────────────────────
sec('【⑤ 实现侧：不许再裸读这些键，必须走 cfgSetOf / quietWindow】');
for (const k of ['auctionPreview', 'quietStart', 'quietEnd', 'viewIdleHours']) {
  const bare = new RegExp('S\\.config\\.' + k + '\\b').test(SV);
  ok(`  server.js 里不再裸读 S.config.${k}`, !bare);
}
ok('竞价预览读的是 cfgSetOf（而不是 S.config 直读）', /if \(!cfgSetOf\('auctionPreview'\)\) return;/.test(SV));
ok('静默时段有唯一出口 quietWindow()', /function quietWindow\(\)/.test(SV));
const qwUses = (SV.match(/quietWindow\(\)/g) || []).length;
ok('inQuietHours 与 pushAll 都读同一个 quietWindow（不许各拼一份）', qwUses >= 3, 'quietWindow() 出现 ' + qwUses + ' 次');
ok('viewIdleMs 读的是 cfgSetOf', /Number\(cfgSetOf\('viewIdleHours'\)\)/.test(SV));

// ── ⑥ 写入端与下发端 ───────────────────────────────────────────────────
sec('【⑥ /api/config 收这些键 + /api/state 下发给面板】');
ok('/api/config 里体检 CFG_SET', /const _badSet = cfgSetErrors\(_setIn\);/.test(SV));
ok('体检不通过 → 整批不写并报错（沿用 CFG_RANGE 那条原则）',
  /if \(_badSet\.length\)[\s\S]{0,220}return json\(res, \{ ok: false/.test(SV));
ok('体检通过后才落内存（bool/hhmm/int 分别归一）', /for \(const k of Object\.keys\(_setIn\)\) \{\s*\n\s*const kd = CFG_SET\[k\]\.kind;/.test(SRC));
ok('/api/state 下发 cfgSet', /cfgSet: cfgSetState\(\),/.test(SV));
ok('cfgSetState 把 label / note / value 一并下发（说明由兑现方产出）',
  /o\[k\] = \{ kind: d\.kind, label: d\.label, note: d\.note, def: d\.def, value: cfgSetOf\(k\) \};/.test(SRC));

// ── ⑦ 面板：真有入口了 ─────────────────────────────────────────────────
sec('【⑦ 面板：那句「去面板上改」现在真有地方可去】');
ok('🛠 工具抽屉里有 cfgSet 容器', /id="cfgSetBox"/.test(HTML));
ok('refresh() 里调用 renderCfgSet', /renderCfgSet\(s\)/.test(HTML));
ok('有 saveCfgSetOne 提交函数', /async function saveCfgSetOne/.test(HTML));
ok('⛔ 输入中不重绘（refresh 每 5 秒一次会冲掉正在敲的内容）',
  /if \(box\.contains\(document\.activeElement\)\) return;/.test(HTML));
ok('⛔ 保存失败要念出服务端原因 + 回绘真实值（否则又是一次"设置静默失效"）',
  /现有设置未被改动/.test(HTML) && /refresh\(\);/.test(HTML.slice(HTML.indexOf('async function saveCfgSetOne'))));
ok('面板不再写死 00:30 / 08:30（时段由服务端下发）', !/00:30|08:30/.test(HTMLX));

// ── ⑧ 那句诊断提示现在说得通了 ─────────────────────────────────────────
sec('【⑧ 「请检查面板的静默时段设置」不再是空头承诺】');
ok('诊断文案仍在（它指向面板）', /请检查面板的静默时段设置/.test(SRC));
ok('而面板确实能改这两个键（quietStart / quietEnd 在 CFG_SET 里）',
  keys.includes('quietStart') && keys.includes('quietEnd') && /id="cfgSetBox"/.test(HTML));

console.log(`\n  断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
