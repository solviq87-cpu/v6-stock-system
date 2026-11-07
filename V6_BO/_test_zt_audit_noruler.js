// 守门：涨停池抽查——「无主尺子」不许直接判错票（FAIL 只给真错票）
// ────────────────────────────────────────────────────────────────────────────────
// 事故（2026-10-28 mq 轮）：
//   `node _audit_zt_pool.js` 判 FAIL（退出码 1），错票只有 002731 萃华退。双源核实它是**真涨停**：
//   腾讯/东财一致返回 收=高=0.28（=round(0.25×1.10,2)）、+12.00%、成交额 9,560,722、换手 15.70，
//   与池条目逐字段吻合。真正的链路是：
//     东财全A快照按 JUNK_NAME_RE 把「退」名称股整体滤掉（5567 行里 0 行）→ 该票没有主尺子
//     → 审计回落 .kline_cache；而缓存当日行是 ths 早盘冻结行（收 0.24、成交 43 万、high 0.25）
//     → 判成「错票」→ 假 FAIL。
//   一天一条假 FAIL 的代价不是麻烦，是「FAIL 这个信号被用坏」—— 真错票来了没人看。
// 钉的语义：
//   ① 快照判未封板（主尺子说 false）→ 真错票 → FAIL
//   ② 快照里没这只票 + 缓存不认 → 「无主尺子·待核实」单列 → WARN，不算错票
//   ③ 快照整体不可用（离线/快照过期）→ 缓存是唯一尺子 → 维持旧行为：判 FAIL（不许借新口径放过）
//   ④ 快照判封板 + 缓存不认 → 缓存失真，池没错 → 只 WARN
'use strict';
const { auditZTPool } = require('./_audit_zt_pool.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');

const DAY = '20261028';
const pool2731 = { code: '002731', name: '萃华退', pct: 12, src: 'em', sector: '饰品' };
const k2731 = { code: '002731', name: '萃华退', rows: [{ date: '2026-10-28', open: 0.24, high: 0.25, low: 0.24, close: 0.24, pct: -4 }] };
// 与 002731 无关的另一只票，用来证明「快照可用」不等于「快照覆盖了这只票」
const otherSnap = { code: '600000', name: '浦发银行', price: 11, preClose: 10, high: 11, low: 10.5, open: 10.6, volume: 1e6, amount: 1e7, pct: 10 };

group('[1] 快照里没这只票 + 缓存不认 → 无主尺子·待核实（WARN，不按错票 FAIL）');
{
  const r = auditZTPool([pool2731], [k2731], { day: DAY, snapRows: [otherSnap], noLimitActive: true });
  ok(r.verdict === 'warn', '判定 warn（实测 ' + r.verdict + '）');
  ok(r.fakeZT.length === 0, '错票 0（旧口径这里是 1 → 假 FAIL）');
  ok(r.noRuler.length === 1 && r.noRuler[0].code === '002731', '单列进 noRuler（002731）');
  ok(r.crossN === 1, '仍计入交叉验证数（有缓存行可看，只是不足以定错票）');
  ok(r.notes.some(n => n.indexOf('无主尺子') >= 0), 'notes 里显式声明待核实（不静默）');
}

group('[2] 快照明确判未封板 → 真错票，必须 FAIL（新口径不许把它放过）');
{
  const snap = Object.assign({}, otherSnap, { code: '002731', name: '萃华退', price: 0.24, preClose: 0.25, high: 0.25, low: 0.24, pct: -4 });
  const r = auditZTPool([pool2731], [k2731], { day: DAY, snapRows: [snap], noLimitActive: true });
  ok(r.verdict === 'fail', '判定 fail（实测 ' + r.verdict + '）');
  ok(r.fakeZT.length === 1 && r.fakeZT[0].code === '002731', '错票 1（主尺子说收 0.24 ≠ 涨停价 0.28）');
  ok(r.noRuler.length === 0, '不进 noRuler（有尺子就不能装没尺子）');
}

group('[3] 反证：快照整体不可用（离线）→ 缓存仍是唯一尺子，判 FAIL 的旧行为必须保留');
{
  const r = auditZTPool([pool2731], [k2731], { day: DAY, snapRows: null, noLimitActive: true });
  ok(r.verdict === 'fail', '离线时仍判 fail（否则「没快照」等于给池子开了免罪符）');
  ok(r.fakeZT.length === 1 && r.noRuler.length === 0, '错票 1 / noRuler 0');
}

group('[4] 快照判封板 + 缓存不认 → 缓存失真，池没错（只 WARN，不计错票）');
{
  const snap = Object.assign({}, otherSnap, { code: '002731', name: '萃华退', price: 0.28, preClose: 0.25, high: 0.28, low: 0.24, pct: 12 });
  const r = auditZTPool([pool2731], [k2731], { day: DAY, snapRows: [snap], noLimitActive: true });
  ok(r.verdict === 'warn', '判定 warn');
  ok(r.fakeZT.length === 0 && r.klineDisagree.length === 1, '归入 klineDisagree（缓存当日行失真），不是错票');
}

group('[5] 反证：主尺子与缓存都认封板 → OK（不许把正常池子常年判 warn）');
{
  const snap = Object.assign({}, otherSnap, { code: '002731', name: '萃华退', price: 0.28, preClose: 0.25, high: 0.28, low: 0.24, pct: 12 });
  const k = { code: '002731', name: '萃华退', rows: [{ date: '2026-10-28', open: 0.24, high: 0.28, low: 0.24, close: 0.28, pct: 12 }] };
  const r = auditZTPool([pool2731], [k], { day: DAY, snapRows: [snap], noLimitActive: true });
  ok(r.verdict === 'ok', '判定 ok（实测 ' + r.verdict + '）');
  ok(r.fakeZT.length === 0 && r.noRuler.length === 0 && r.missed.length === 0, '错票/无主尺子/漏票 全 0');
}

group('[6] 002731 实况回归：0.28 是被舍入放大的涨停价，不许被当成「超限幅」');
{
  const snap = Object.assign({}, otherSnap, { code: '002731', name: '萃华退', price: 0.28, preClose: 0.25, high: 0.28, low: 0.24, pct: 12 });
  const k = { code: '002731', name: '萃华退', rows: [{ date: '2026-10-28', open: 0.24, high: 0.28, low: 0.24, close: 0.28, pct: 12 }] };
  const r = auditZTPool([pool2731], [k], { day: DAY, snapRows: [snap], noLimitActive: true });
  ok(r.aboveLimit.length === 0, '不被归进「口径存疑/超限幅」（pct 12% 是分币舍入，不是数据错）');
  ok(r.pctDiff.length === 0, '池 pct 与缓存 pct 一致 → 无偏差告警');
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
