// 外部可控参数的边界（本轮新角度）。
//
// 前面几轮盯的都是"自己人写错"：内存与磁盘不一致、锁不释放、量纲写反、提示词撒谎。
// 这一轮换到另一头 —— **请求里带进来的东西，进了路由之后到底被当成什么用**：
//
//   · 空值：撤销设备那条判的是 `d.startsWith(id)`，而空串是所有字符串的前缀 ——
//     不带 id 的一次请求会把两台账里每一台设备全部删光，并逐条写进 revoked 名单
//     （撤销写名单，重启也不回来），发起者自己也在名单里，当场把自己锁在门外。
//   · 原型链：申请号直接 `bag[b.req]` 取值，传 '__proto__' 会命中原型链（恒真值），
//     放行分支接着把新签发的只读令牌写进 Object.prototype —— 全进程每个对象都多出一个 token。
//   · 类型混淆 / 负数：`Number(b.n) || 30` 只挡了 NaN 与 0，负数照样穿过去
//     （slice(0, -5) 与"取前 5 名"是两回事）；prune 的 days 传负数会把"过期线"推到未来，
//     等于一次不留痕的全网下线。
//   · 体积：请求体 `body += d` 来多少收多少，Node 默认不限长度 ——
//     一个几百 MB 的 POST 就能把进程内存吃干；口令同理，scryptSync 是同步的，
//     几十 MB 的"密码"会让整个进程卡死（外面看既不是报错也不是崩溃，就是假死）。
//
// 共同点：**不报错、不崩溃、功能也没坏，只是被一个畸形输入一次性打穿**。
// 所以本测试尽量做交叉校验（拿常量去比对文案 / 把判据切进沙箱真跑），而不只是钉死源码字符串。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// ⛔ 一律在剥掉注释的版本上判"活代码"：本项目注释里会逐字引用旧写法来解释历史 bug（已踩 12 次）
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
const lineOf = i => SV.slice(0, i).split('\n').length;

// ⛔ 语义边界取块：从 startMarker 起，到下一个**顶层路由分支**为止。
//    钉死 slice(i, i+N) 的话，往上游加注释或加代码就会把窗口切歪（已踩多次）。
function block(startMarker) {
  const i = CODE_K.indexOf(startMarker);
  if (i < 0) return '';
  const j = CODE_K.indexOf("\n  if (p === '", i + startMarker.length);
  return CODE_K.slice(i, j < 0 ? CODE_K.length : j);
}

// ============================================================
group('[1] 请求体体积：必须有上限，超限必须回 413 且不进业务');
{
  ok('定义了 BODY_LIMIT 常量', /const BODY_LIMIT\s*=\s*\d/.test(CODE_K));
  // ⚠️ 常量写成 `8 * 1024 * 1024` 这种表达式，不能只抠第一个数字（那会抠到 8）
  const mbExpr = (CODE_K.match(/const BODY_LIMIT\s*=\s*([^;\n]+)/) || [])[1] || '0';
  const mb = Number(new Function('return (' + mbExpr + ')')());
  ok('上限不小于 2 MB（够在线改源码用）', mb >= 2 * 1024 * 1024, String(mb));
  // server.js 本体经 JSON 转义后约 1 MB，上限必须留得出这个量
  const svBytes = Buffer.byteLength(SV, 'utf8');
  ok('上限容得下 server.js 全文（发布包里最大的一份可编辑源码）', mb > svBytes * 2,
    `${mb} vs ${svBytes}`);

  // ⛔ 只认 POST 那一支：createServer 回调里 GET 那一支同样会经过 'end'
  const post = block("if (req.method === 'POST') {");
  ok('POST 分支里做了长度判定', /body\.length\s*>\s*BODY_LIMIT/.test(post));
  ok('超限后回 413', /writeHead\(413/.test(post));
  ok('超限后不再调用 handle（本次请求不执行任何操作）',
    /if\s*\(_bodyOver\)\s*\{[\s\S]{0,400}return;?\s*\}/.test(post));
  ok('超限留了日志（否则事后无法解释为什么那个请求没生效）', /\[http\][^\n]{0,40}超限/.test(post));
  // 反证：旧写法 `req.on('end', () => ...handle(...))` 完全没有长度判定
  const old = "let body = '';\n    req.on('data', d => body += d);\n    req.on('end', () => _pushCtx.run({ manual: true }, () => handle(req, res, u, body)));";
  ok('反证：旧写法（无长度判定、无 413）应当判不合格',
    !/BODY_LIMIT/.test(old) && !/413/.test(old));
}

// ============================================================
group('[2] 撤销设备：空 id 必须被拒（空串是所有字符串的前缀）');
{
  const rv = block("if (p === '/api/lock/revoke' && req.method === 'POST') {");
  ok('取到 revoke 路由块', rv.length > 0);
  const iGuard = rv.indexOf('if (!id)');
  const iUse = rv.indexOf('startsWith(id)');
  ok('存在空 id 守卫', iGuard >= 0);
  ok('空 id 守卫在 startsWith(id) 之前（先拦后用）',
    iGuard >= 0 && iUse >= 0 && iGuard < iUse, `guard=${iGuard} use=${iUse}`);
  ok('守卫文案说明了"空 id 会被当成匹配所有设备"',
    /id 不能为空/.test(rv) && /匹配所有设备/.test(rv));
  // 反证：把空串塞进 startsWith，恒真 —— 这正是旧代码一次请求清空全部台账的原因
  ok('反证：startsWith(空串) 恒真（旧写法下不带 id = 删光所有设备）',
    'FPREFIX-ANY'.startsWith('') === true);
  ok('反证：hasOwnProperty 对空串判假（新写法只认自有属性）',
    Object.prototype.hasOwnProperty.call({ a: 1 }, '') === false);
}

// ============================================================
group('[3] 只读申请号：外部字符串不许直接当对象键（原型链污染）');
{
  ok('定义了 _vpGet 收口函数', /function _vpGet\(/.test(CODE_K));
  const g = block('function _vpGet(');
  ok('_vpGet 只认字符串键', /typeof\s+\w+\s*!==\s*'string'/.test(g));
  ok('_vpGet 用 hasOwnProperty 只认自有属性',
    /hasOwnProperty\.call\(bag,\s*\w+\)/.test(g));

  // ⛔ 两处调用点都必须改走 _vpGet：直接 bag[...] 的写法在剥注释后不许再出现
  // ⚠️ pending-status 里 `delete bag[id]`（取走后删除）与 `bag[id] = it`（落盘失败时原样还回）
  //    都是**写**，且走的都是已经过 _vpGet 的自有属性，属正当用法，要排除掉 ——
  //    这里只禁"拿外部字符串直接去**取值**"。
  const direct = [...CODE_K.matchAll(/(?<!delete\s)\bbag\[(?:b\.req|id)\](?!\s*=)/g)];
  ok('不再有任何 bag[b.req] / bag[id] 的直接索引', direct.length === 0,
    direct.map(m => m[0]).join(','));
  const appr = block("if (p === '/api/lock/pending-approve' && req.method === 'POST') {");
  const stat = block("if (p === '/api/lock/pending-status' && req.method === 'GET') {");
  ok('放行分支走 _vpGet', /_vpGet\(b\.req\)/.test(appr));
  ok('轮询分支走 _vpGet', /_vpGet\(id\)/.test(stat));

  // 反证：真跑一次原型链取值 —— 旧写法下 '__proto__' 是恒真的"存在的申请"
  const bag = {};
  const oldHit = bag['__proto__'];
  ok('反证：bag[__proto__] 在旧写法下是真值（会被当成一条真实申请）', !!oldHit);
  ok('反证：hasOwnProperty 把它挡住',
    Object.prototype.hasOwnProperty.call(bag, '__proto__') === false);
  // 污染后果：往它上面写属性 = 全进程每个对象都多一个 token
  ok('反证：往 bag[__proto__] 上写属性会污染所有对象（({}).token 也会读到）',
    (() => { try { bag['__proto__'].token = 'LEAK'; return ({}).token === 'LEAK'; } catch { return false; } })());
  delete Object.prototype.token;
}

// ============================================================
group('[4] 整数入参：统一走 _clampInt，NaN / 负数 / 天文数字都落回区间');
{
  ok('定义了 _clampInt', /function _clampInt\(/.test(CODE_K));
  const src = (CODE_K.match(/function _clampInt\(v, lo, hi, dflt\) \{[\s\S]*?\n\}/) || [])[0];
  ok('抠得出 _clampInt 源码', !!src);
  const clamp = src ? new Function('return ' + src)() : null;
  if (clamp) {
    ok('NaN → 默认值', clamp(NaN, 1, 200, 30) === 30, String(clamp(NaN, 1, 200, 30)));
    ok('undefined → 默认值', clamp(undefined, 1, 200, 30) === 30);
    ok('负数 → 下界（旧写法 `|| 30` 会让 -5 直接穿过去）',
      clamp(-5, 1, 200, 30) === 1, String(clamp(-5, 1, 200, 30)));
    ok('0 → 下界', clamp(0, 1, 200, 30) === 1);
    ok('天文数字 → 上界', clamp(1e9, 1, 200, 30) === 200);
    ok('小数取整', clamp(7.6, 1, 200, 30) === 8);
    ok('区间内原样返回', clamp(50, 1, 200, 30) === 50);
    ok('Infinity → 默认值（不是上界，避免 1/0 之类的输入悄悄变成"取最大值"）',
      clamp(Infinity, 1, 200, 30) === 30, String(clamp(Infinity, 1, 200, 30)));
  }
  // 反证：旧写法 Number(x) || 30 挡不住负数
  const old = v => Number(v) || 30;
  ok('反证：旧写法下 -5 会原样穿过去（slice(0,-5) ≠ 取前 5 名）', old(-5) === -5);

  // 五处入参都必须过钳制：扫描条数 ×4 + 变更记录条数 + 设备清理天数
  const ts = block("if (p === '/api/trend-scan' && req.method === 'POST') {");
  const su = block("if (p === '/api/steady-up' && req.method === 'POST') {");
  const zp = block("if (p === '/api/ztpre' && req.method === 'POST') {");
  const kb = block("if (p === '/api/kline-backfill' && req.method === 'POST') {");
  const ops = block("if (p === '/api/holdings/ops' && req.method === 'GET') {");
  const dev = block("if (p === '/api/lock/devices' && req.method === 'POST') {");
  ok('全市场扫描条数过钳', /_clampInt\(b\.n/.test(ts));
  ok('连续收涨条数过钳', /_clampInt\(b\.n/.test(su));
  ok('涨停前形态条数过钳', /_clampInt\(_z\.n/.test(zp));
  ok('K线补齐条数过钳', /_clampInt\(b\.n/.test(kb));
  ok('变更记录条数过钳', /_clampInt\(/.test(ops));
  ok('设备清理天数过钳（负数会把过期线推到未来 = 一次不留痕的全网下线）',
    /_clampInt\(b\.days/.test(dev));
  // ⛔ 旧写法 `Number(b.x) || N` 在剥注释后不许再出现于这些路由里
  const legacy = [...CODE_K.matchAll(/Number\((?:b|_z)\.(?:n|days)\)\s*\|\|/g)];
  ok('不再有 `Number(b.n) || N` / `Number(b.days) || N` 的裸兜底', legacy.length === 0,
    legacy.map(m => m[0]).join(','));
}

// ============================================================
group('[5] 口令长度：scryptSync 是同步的，超长输入会让进程假死');
{
  ok('定义了 PWD_MAXLEN 常量', /const PWD_MAXLEN\s*=\s*\d+/.test(CODE_K));
  const mx = Number((CODE_K.match(/const PWD_MAXLEN\s*=\s*(\d+)/) || [])[1] || 0);
  ok('上限在 64 ~ 1024 之间（够长又不至于挡住真人）', mx >= 64 && mx <= 1024, String(mx));

  // pwdOk 是唯一校验入口，长度判定必须在昂贵的 hashPwd 之前
  const pk = block('function pwdOk(pwd, role) {');
  const iLen = pk.indexOf('length > PWD_MAXLEN');
  const iHash = pk.indexOf('hashPwd(');
  ok('pwdOk 里做了长度判定', iLen >= 0);
  ok('长度判定在 hashPwd 之前（超限直接判错，不做派生）',
    iLen >= 0 && iHash >= 0 && iLen < iHash, `len=${iLen} hash=${iHash}`);

  // 三处"设置新口令"都要有上界，且文案与常量一致
  const setup = block("if (p === '/api/lock/setup' && req.method === 'POST') {");
  const chg = block("if (p === '/api/lock/change' && req.method === 'POST') {");
  const rst = block("if (p === '/api/lock/reset-pwd' && req.method === 'POST') {");
  ok('设置口令有上界', /length\s*>\s*PWD_MAXLEN/.test(setup));
  ok('改口令有上界', /length\s*>\s*PWD_MAXLEN/.test(chg));
  ok('找回重置口令有上界', /length\s*>\s*PWD_MAXLEN/.test(rst));
  // 文案里的数字必须与常量对得上（否则用户照着提示做一定失败）
  const texts = [...SV.matchAll(/'(?:新)?密码至少 4 位，且不超过 (\d+) 位'/g)].map(m => Number(m[1]));
  ok('三处文案都写了上界', texts.length === 3, String(texts.length));
  ok('文案里的上界与 PWD_MAXLEN 一致', texts.every(v => v === mx), texts.join(','));
  // 反证：旧写法只有下界
  ok('反证：旧写法 `!pwd || pwd.length < 4` 挡不住超长口令',
    (() => { const pwd = 'x'.repeat(5000); return !(!pwd || pwd.length < 4); })());
}

// ============================================================
group('[6] 直接推送的正文：长度必须封顶（超了是整条发不出去）');
{
  const pn = block("if (p === '/api/push-note' && req.method === 'POST') {");
  ok('取到 push-note 路由块', pn.length > 0);
  ok('正文有 slice 上限', /text\s*=\s*String\(b\.text \|\| ''\)\.slice\(0,\s*\d+\)/.test(pn));
  ok('标题有 slice 上限', /title\s*=\s*String\(b\.title \|\| title\)\.slice\(0,\s*\d+\)/.test(pn));
  const cap = Number((pn.match(/b\.text \|\| ''\)\.slice\(0,\s*(\d+)\)/) || [])[1] || 0);
  ok('正文上限不超过 8000（飞书单条消息的长度量级）', cap > 0 && cap <= 8000, String(cap));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
