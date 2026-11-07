// 守门：④ 本地耐久化（pushlog 合并逻辑）
// 与 _runall.js 同口径：退出码非0=红；汇总行认「通过 N / M 失败」。
// 纯函数模块，不联网、不碰磁盘，mock 跑。
const assert = require('assert');
const { pushLogKey, mergePushLogs } = require('./_pushlog_durable.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + name); }
}
function eq(name, a, b) { ok(name + ' (期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a) + ')', a === b); }

// 1) pushLogKey 三要素组合
eq('pushLogKey 基本格式', pushLogKey({ ts: 100, title: '复盘', status: 'sent' }), '100|复盘|sent');
eq('pushLogKey 缺字段补空', pushLogKey({ ts: 0 }), '0||');
eq('pushLogKey 坏输入不崩', typeof pushLogKey(null), 'string');
eq('pushLogKey 坏输入不崩(空对象)', typeof pushLogKey({}), 'string');

// 2) 去重：相同 key 只保留一条（existing 在先，保留 existing 那条）
{
  const a = { ts: 100, title: '复盘', status: 'sent', src: 'mem' };
  const b = { ts: 100, title: '复盘', status: 'sent', src: 'dur' }; // 同 key，应被去重
  const m = mergePushLogs([a], [b], 500);
  eq('去重后条数', m.length, 1);
  eq('去重保留先出现的来源', m[0].src, 'mem');
}

// 3) 合并：互补内容（不同 key）并集
{
  const a = { ts: 100, title: '复盘', status: 'sent' };
  const b = { ts: 200, title: '一进二', status: 'sent' };
  const m = mergePushLogs([a], [b], 500);
  eq('互补合并条数', m.length, 2);
}

// 4) 倒序：ts 大的在前
{
  const a = { ts: 100, title: '复盘', status: 'sent' };
  const b = { ts: 200, title: '一进二', status: 'sent' };
  const c = { ts: 150, title: '连板', status: 'sent' };
  const m = mergePushLogs([a, b, c], [], 500);
  ok('倒序 a<b<c', m[0].ts === 200 && m[1].ts === 150 && m[2].ts === 100);
}

// 5) 容量裁剪：超过 cap 只留前 cap 条（已倒序，保留最新的）
{
  const arr = [];
  for (let i = 1; i <= 600; i++) arr.push({ ts: i, title: 't' + i, status: 'sent' });
  const m = mergePushLogs(arr, [], 500);
  eq('cap 裁剪后条数', m.length, 500);
  eq('cap 保留最新(ts 最大)', m[0].ts, 600);
  eq('cap 末位 ts', m[499].ts, 101); // 600-499=101
}

// 6) cap 缺省=500
{
  const arr = [];
  for (let i = 1; i <= 600; i++) arr.push({ ts: i, title: 't' + i, status: 'sent' });
  const m = mergePushLogs(arr, []);
  eq('缺省 cap=500', m.length, 500);
}

// 7) 坏输入不崩：existing/incoming 为 null/undefined/非数组
ok('坏输入 existing=null', Array.isArray(mergePushLogs(null, [{ ts: 1, title: 'x', status: 's' }], 500)));
ok('坏输入 incoming=undefined', Array.isArray(mergePushLogs([{ ts: 1, title: 'x', status: 's' }], undefined, 500)));
ok('坏输入 两者皆空', Array.isArray(mergePushLogs(null, null, 500)) && mergePushLogs(null, null, 500).length === 0);
ok('坏输入 元素缺 ts', (() => { const m = mergePushLogs([{ title: 'x', status: 's' }], [], 500); return m.length === 1 && m[0].ts === undefined; })());

// 8) 启动合并真实场景：内存被 500 裁掉早期的，durable 副本有早期证据 → 合并后恢复
{
  const mem = [];
  for (let i = 101; i <= 600; i++) mem.push({ ts: i, title: 't' + i, status: 'sent' }); // 500 条，最新 500 条
  const dur = [];
  for (let i = 1; i <= 100; i++) dur.push({ ts: i, title: 't' + i, status: 'sent' }); // 早期 100 条（被裁）
  const m = mergePushLogs(mem, dur, 500); // 去重后 600 条 → 裁到 500 → 保留 ts 600..101，早期 1..100 被裁掉仍丢失！
  // 关键说明：cap=500 时容量仍为瓶颈，单靠本地副本无法突破 cap。本测试验证“去重正确、不重复”即可；
  // 真正恢复早期证据需把 cap 提到 > 历史总量（或 durable 独立保留全量）。此处验证合并不丢新证据、不重复。
  eq('启动合并后无重复', new Set(m.map(pushLogKey)).size, m.length);
  eq('启动合并保留最新 500', m.length, 500);
  eq('启动合并最新在前', m[0].ts, 600);
}

// 9) hu 轮 TDZ 防回归：启动合并块不许在模块初始化期调 dataCapOf（读后置 const DATA_CAP）
//    事故：合并时传 dataCapOf('pushLog') 裁容量 → 每次启动都撞 TDZ 被 catch 吞成「降级」，
//    durable 镜像里的早期证据一条都没恢复（server.log 每次启动都有 [durable] ⚠️，潜伏多日）。
//    修法与 hi 轮 pushlog 载入同原则：载入期不裁容量，全量并内存，运行时统一收敛。
{
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const m = src.match(/\/\/ ④ 本地耐久化：把 durable\/ 镜像副本合并回内存[\s\S]*?console\.error\('\[durable\][^\n]*/);
  const blk = m ? m[0] : '';
  ok('durable 合并块存在（锚点命中）', blk.length > 0);
  const code = blk.replace(/\/\/[^\n]*/g, '');   // 剥行注释再判，防注释里提到 dataCapOf 造成假红/假绿
  ok('durable 合并块代码不调 dataCapOf（TDZ 防回归）', !/dataCapOf/.test(code));
  ok('durable 合并不传 cap（载入期全量进内存，运行时裁）', /mergePushLogs\(PUSH_LOG, _dur\)/.test(code));
  // 沙箱真跑：dataCapOf 一调就炸的环境下，合并块照样完成且早期证据并进内存
  const sandbox = new Function('path', 'DURABLE_DIR', 'readJsonSafe', 'PUSH_LOG', 'mergePushLogs', 'dataCapOf', [
    blk,
    'return PUSH_LOG.length;'
  ].join('\n'));
  const PUSH_LOG = [{ ts: 200, title: '新', status: 'sent' }];
  const dur = [{ ts: 100, title: '旧', status: 'sent' }, { ts: 200, title: '新', status: 'sent' }];
  let threw = null, len = -1;
  try {
    len = sandbox(
      { join: (...a) => a.join('/') },
      '/durable',
      () => dur,
      PUSH_LOG,
      mergePushLogs,
      () => { throw new Error("Cannot access 'DATA_CAP' before initialization"); }
    );
  } catch (e) { threw = e; }
  ok('沙箱：dataCapOf 抛 TDZ 时合并不崩', threw === null);
  ok('沙箱：早期证据并进内存（去重后 2 条）', len === 2);
}

console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);