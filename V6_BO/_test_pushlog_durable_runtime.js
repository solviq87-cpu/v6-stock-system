// 守门（运行时往返）：④ 本地耐久化真实磁盘路径验证
// 复刻 server.js 的 mirrorDurable + 启动合并，用真实 fs 在临时目录跑，证明：
//   (1) 每次 flush 把 PUSH_LOG 镜像到 durable/pushlog.json（原子写）
//   (2) 重启（内存清空）后从 durable 副本 mergePushLogs 恢复，不重复、不丢新证据
//   (3) marketBeta.json 同步镜像
// 不启全服务、不联网。与 _runall 同口径：退出码非0=红。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergePushLogs } = require('./_pushlog_durable.js');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-rt-'));
const DURABLE = path.join(DIR, 'durable');
fs.mkdirSync(DURABLE, { recursive: true });
function atomicWrite(p, s) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, s, 'utf8');
  fs.renameSync(tmp, p);
}
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗ ' + name); } }

// ---- 模拟场景：线上容器被回收，内存 PUSH_LOG 清零，但 durable 副本仍在 ----
// 第一世（flush 阶段）：内存有 3 条
const PUSH_LOG = [
  { ts: 1700000100000, title: '复盘 · 2026-10-14', status: 'sent' },
  { ts: 1700000200000, title: '一进二 · 次日连板潜力榜', status: 'sent' },
  { ts: 1700000300000, title: '竞价 · 09:25 必达', status: 'sent' },
];
const marketBeta = { beta: 0.82, upRatio: 55, ts: 1700000300000 };

// (1) mirrorDurable：flush 时镜像
atomicWrite(path.join(DURABLE, 'pushlog.json'), JSON.stringify(PUSH_LOG));
atomicWrite(path.join(DURABLE, 'marketBeta.json'), JSON.stringify(marketBeta));
ok('durable/pushlog.json 已生成', fs.existsSync(path.join(DURABLE, 'pushlog.json')));
ok('durable/marketBeta.json 已生成', fs.existsSync(path.join(DURABLE, 'marketBeta.json')));

// (2) 第二世（重启）：内存被回收清零，从 durable 副本合并
const memAfterRestart = []; // 重启瞬间内存空
const durCopy = JSON.parse(fs.readFileSync(path.join(DURABLE, 'pushlog.json'), 'utf8'));
const merged = mergePushLogs(memAfterRestart, durCopy, 500);
ok('重启后从本地副本恢复 3 条', merged.length === 3);
ok('重启恢复无重复', new Set(merged.map(r => (r.ts) + '|' + r.title + '|' + r.status)).size === 3);
ok('重启恢复最新在前', merged[0].ts === 1700000300000);

// (3) 叠加新推送再 flush：内存有 durable 的 3 条 + 新 1 条；flush 后 durable 仍是去重全量 4 条
const newEntry = { ts: 1700000400000, title: '学习日报 · 2026-10-14', status: 'sent' };
const memWithOld = mergePushLogs([], durCopy, 500); // 模拟合并进内存
memWithOld.push(newEntry);
atomicWrite(path.join(DURABLE, 'pushlog.json'), JSON.stringify(memWithOld));
const reread = JSON.parse(fs.readFileSync(path.join(DURABLE, 'pushlog.json'), 'utf8'));
ok('叠加新推送后 durable 共 4 条', reread.length === 4);
ok('叠加后无重复', new Set(reread.map(r => (r.ts) + '|' + r.title + '|' + r.status)).size === 4);

// (4) marketBeta 镜像内容正确
const betaCopy = JSON.parse(fs.readFileSync(path.join(DURABLE, 'marketBeta.json'), 'utf8'));
ok('marketBeta 镜像内容一致', betaCopy.beta === 0.82 && betaCopy.upRatio === 55);

// (5) 原子写：临时文件不残留（rename 后 .tmp 不存在）
ok('原子写无 .tmp 残留', !fs.existsSync(path.join(DURABLE, 'pushlog.json.tmp')));

// 清理
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}

console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
