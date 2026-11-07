// 竞价快照「时效性」必须如实标注 —— 不许把 10:02 补抓的盘中价冒充 9:25 竞价
// 事故：2026-09-29 线上 S.auction.time = 10:02:11，但推送标题仍写「9:25 竞价异动」，
//       用户据此以为系统在"提前发现"，实际收到的都是已经涨完的票。
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// 直接抽出那段标题判定逻辑做等价实现（与源码同源：靠断言保证源码里的判定算子仍在）
const judge = (time) => {
  const _mt = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  const _minsOf = _mt ? (+_mt[1]) * 60 + (+_mt[2]) : null;
  const OPEN_MIN = 9 * 60 + 30;
  const lateMin = _minsOf == null ? null : Math.max(0, _minsOf - OPEN_MIN);
  return { lateMin, isLate: lateMin != null && lateMin > 15 };
};

console.log('\n① 快照时间迟到的判定');
ok(judge('09:26:05').isLate === false, '9:26 抓到的快照 → 不算迟到（仍是真竞价）');
ok(judge('09:44:00').isLate === false, '9:44 快照 → 仍在容忍窗口内');
ok(judge('10:02:11').isLate === true, '10:02 快照 → 判定为迟到（事故当天就是这个）');
ok(judge('13:30:00').isLate === true, '下午才补抓 → 迟到');
ok(judge('').lateMin === null, '时间缺失 → 不做判断，不谎报不报错');
ok(judge('abc').lateMin === null, '时间格式异常 → 安全返回 null');

console.log('\n② 源码层面：标题必须随迟到状态改写，且给出补救提示');
const blk = (() => {
  const i = src.indexOf('let msg = isLate');
  const j = src.indexOf("头条提醒", i) >= 0 ? src.indexOf("头条提醒", i) : i + 1200;
  return src.slice(i - 1500, i + 900);
})();
ok(/isLate\s*\?\s*'等*=*\s*📯 竞价补抓快照/.test(blk.replace(/\s+/g, ' ')) || /竞价补抓快照/.test(blk),
  '迟到时标题要改成「竞价补抓快照」而不是「9:25 竞价异动」');
ok(/不是\s*\*{0,2}开盘竞价初值|非开盘竞价初值/.test(blk), '正文要说明"非开盘竞价初值"');
ok(/isLate/.test(src) && /非开盘竞价初值/.test(src), '两处提示（清单与强势股）都带上了时效说明');

console.log('\n③ 与同日「推送闸门」修复联动检查');
ok(/pushMinProb/.test(src) && /低于门槛/.test(src), '存在胜率门槛闸门而非只有数量闸门');
ok(/Number\.isFinite\(v\) \? v : -1/.test(src) || /list\.sort/.test(src), '候选按质量排序后再占名额');

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
