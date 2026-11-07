'use strict';
// 守门：竞价定稿补发窗（if 轮 D1，用户 2026-10-16 决策表）
// 背景：主窗口 9:25:20~9:26:00 只有 40 秒，数据源一抖动（限流退避可至 120s）当天竞价推送
//       就永久静默（10-15 线上实测：17:33 健康告警×2 证实竞价两条漏发）。
// 修法：新增补发窗 9:26:00~9:29:59 —— hv 轮已实证这一段 auctionPhase===3，
//       open=法定开盘价、amtReliable=true，快照就是纯竞价结果（迟到但真实）；
//       9:30 连续竞价一开始，价格即被改写，那时再发才是马后炮。
// ⛔ 钉三件事：① 补发窗存在且只到 9:29:59；② 9:30 硬断（清零+不再发）；
//    ③ phase 口径真的支持「9:26~9:29 抓的仍是竞价结果」（拿真函数跑，不是看注释）。

const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };

// ① 定稿定时器两个窗口都在（主窗口 + 补发窗），且补发窗上界钉在 9:30
ok(/_inMain = t >= 9 \* 60 \+ 25 && t < 9 \* 60 \+ 26/.test(SRC), '① 主窗口 9:25~9:26 仍在');
ok(/_inLate = t >= 9 \* 60 \+ 26 && t < 9 \* 60 \+ 30/.test(SRC), '② 补发窗 9:26~9:30（上界 9:29:59）');
ok(/\(_inMain \|\| _inLate\)/.test(SRC), '③ 两个窗口共用同一套发送逻辑（不是另起一条路径）');
ok(/if \(t >= 9 \* 60 \+ 30\) \{ auctionTries = 0; auctionLateTries = 0; \}/.test(SRC),
  '④ 9:30 起窗口完全结束：重试计数清零，此后一切“竞价”消息都不再自动发');
ok(/auctionLateTries/.test(SRC), '⑤ 补发窗有独立重试计数（不把主窗口的 3 次试完就算数）');

// ② phase 口径真跑：9:26~9:29:59 必须是 phase 3（纯竞价结果），9:30 必须是 0
{
  const grab = (start, end) => {
    const i = SRC.indexOf(start); if (i < 0) throw new Error('找不到 ' + start);
    const j = SRC.indexOf(end, i); if (j < 0) throw new Error('找不到结束标记 ' + end);
    return SRC.slice(i, j + end.length);
  };
  const ph = new Function('isTradeDay',
    grab('function auctionPhase(d) {', '\n}') + '\nreturn auctionPhase;')(() => true);
  const at = (h, m, s) => { const d = new Date(2026, 9, 16, h, m, s); return d; };
  ok(ph(at(9, 25, 30)) === 3, '⑥ 9:25:30 → phase 3（法定开盘价）');
  ok(ph(at(9, 26, 0)) === 3, '⑦ 9:26:00 → phase 3（补发窗起点仍是竞价结果）');
  ok(ph(at(9, 29, 59)) === 3, '⑧ 9:29:59 → phase 3（补发窗终点仍是竞价结果）');
  ok(ph(at(9, 30, 0)) === 0, '⑨ 9:30:00 → phase 0（连续竞价开始，再发就是马后炮）');
  ok(ph(at(9, 24, 59)) === 2, '⑩ 9:24:59 → phase 2（主窗口前仍是虚拟匹配价，口径没被改动）');
}

// ③ 迟到快照不许冒充 9:25：标题/正文仍走 buildAuctionAlertMessage（它带真实快照时间）
ok(/const msg = buildAuctionAlertMessage\(au, false\);/.test(SRC), '⑪ 定稿推送仍走 buildAuctionAlertMessage（迟到快照如实标注时间）');

// ④ 体检表登记不变（只告警不补推；补推由定时器自己在窗口内完成）
ok(/key: 'auctionFinal'[\s\S]{0,200}?dueMin: 9 \* 60 \+ 25[\s\S]{0,200}?heal: null/.test(SRC),
  '⑫ 体检表 auctionFinal 仍只告警（heal:null），不另开自动补推路径');

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
