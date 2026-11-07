// 守门：jc 轮「竞价共振」模块（2026-10-20）
// 集合竞价 + 强势板块 → 盘中强势票，手机端展示在量化选股下方。
const fs = require('fs');
const A = require('./analysis.js');
const srvSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mobSrc = fs.readFileSync(__dirname + '/public/mobile.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// ① 后端函数与路由存在
sec('① 后端 auctionResonanceScan 与 /api/auction-resonance 存在');
{
  const scan = srvSrc.match(/async function auctionResonanceScan\(opts = \{\}\) \{[\s\S]*?\n\}/);
  ok(!!scan, 'auctionResonanceScan 函数体可提取');
  if (scan) {
    const body = scan[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    ok(/loadSectorHistory\(\)/.test(body), '读取板块历史（近5日净流入/近3日回撤）');
    ok(/sectorRank/.test(body), '计算板块排名');
    ok(/topSectorNames/.test(body), '锁定强势板块前20');
    ok(/buildZTRoleMap\(\)/.test(body), '引入题材梯队/连板惯性');
    ok(/reasons\.push/.test(body), '生成推断依据');
    ok(/score/.test(body), '输出评分');
    ok(/logSignal\('aucres'/.test(body), 'jf 轮：竞价共振信号登记到学习库（type=aucres）');
  }
  ok(/'aucres':\s*'ztNext'/.test(srvSrc), "jf 轮：aucres probKind='ztNext'（按次日涨停口径学习）");
  ok(/p === '\/api\/auction-resonance'/.test(srvSrc), '/api/auction-resonance 路由存在');
  ok(/await auctionResonanceScan\(\{ force, max, board \}\)/.test(srvSrc), '路由直通 auctionResonanceScan 并透传 board');
  // ju 轮（2026-10-22）：随量化选股一并把 force 重算收回给开发者（理由同 _test_quant_picks.js）
  ok(/p === '\/api\/auction-resonance'\);?\s*\{\s*const force = isEditorReq\(req\) && \(\(u\.searchParams\.get\('force'\) === '1'\) \|\| \(req\.method === 'POST'\)\)/.test(srvSrc),
    'ju 轮：force=1/POST 重算收回给开发者（只读照常看缓存结果）');
  ok(/pushAuctionResonanceTop3/.test(srvSrc), 'Top3 私密推送函数存在');
  // jl 轮：板块筛选（主板/创业板/全部）
  if (scan) {
    const body = scan[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    ok(/opts\.board/.test(body), 'auctionResonanceScan 读取 opts.board');
    ok(/A\.isMainBoard/.test(body), '主板筛选调用 A.isMainBoard');
    ok(/A\.isGEM/.test(body), '创业板筛选调用 A.isGEM');
    ok(/_auctionResonanceCache\.get\(board\)/.test(body), '缓存按 board 隔离');
    ok(/board === 'all'/.test(body), "Top3 推送只在 board='all' 触发，避免切换时重复刷屏");
  }
}

// ② 板块历史落盘
sec('② 板块历史按日落盘 sector_history.json');
{
  ok(/_recordSectorHistory/.test(srvSrc), '_recordSectorHistory 存在');
  ok(/sector_history\.json/.test(srvSrc), '落盘路径为 sector_history.json');
  const m = srvSrc.match(/const _recordSectorHistory = rows => \{[\s\S]*?\n  \};/);
  ok(!!m, '_recordSectorHistory 函数体可提取');
  if (m) {
    ok(/hist\[day\] = top/.test(m[0]), '按日存储板块摘要');
    ok(/slice\(-90\)/.test(m[0]), '只保留近90天防止无限增长');
  }
}

// ③ 前端手机渲染
sec('③ 前端 mobile.html 渲染竞价共振卡片');
{
  ok(/id="arCard"/.test(mobSrc), '存在 arCard 卡片容器');
  ok(/id="arBody"/.test(mobSrc), '存在 arBody 内容区');
  ok(/function renderAuctionResonance\(d\)/.test(mobSrc), 'renderAuctionResonance 函数存在');
  ok(/function loadAuctionResonance/.test(mobSrc), 'loadAuctionResonance 函数存在');
  ok(/loadAuctionResonance\(false\)/.test(mobSrc), '初始化时调用 loadAuctionResonance');
  ok(/\/api\/auction-resonance/.test(mobSrc), '前端请求 /api/auction-resonance');
  // jl 轮：板块筛选 UI
  ok(/function setArBoard\(board\)/.test(mobSrc), '存在 setArBoard 切换函数');
  ok(/ar-filter/.test(mobSrc), '存在 ar-filter 筛选按钮容器');
  ok(/setArBoard\('\$\{k\}'\)/.test(mobSrc), '筛选按钮绑定 setArBoard');
  ok(/全部/.test(mobSrc), '存在「全部」按钮文案');
  ok(/主板/.test(mobSrc), '存在「主板」按钮文案');
  ok(/创业板/.test(mobSrc), '存在「创业板」按钮文案');
  ok(/board=/.test(mobSrc), 'loadAuctionResonance 请求携带 board 参数');
  ok(/localStorage\.setItem\('arBoard'/.test(mobSrc), '板块选择持久化到 localStorage');
}

// ④ jm 轮补漏：主板/创业板代码正则必须是 6 位，不能写成 5 位
sec('④ 板块代码正则回归（6 位代码）');
{
  ok(A.isMainBoard('600000'), '浦发银行 600000 是主板');
  ok(A.isMainBoard('000001'), '平安银行 000001 是主板');
  ok(A.isMainBoard('002032'), '苏泊尔 002032 是主板');
  ok(!A.isMainBoard('688000'), '科创板 688000 不是主板');
  ok(!A.isMainBoard('300226'), '创业板 300226 不是主板');
  ok(A.isGEM('300226'), '上海钢联 300226 是创业板');
  ok(A.isGEM('301218'), '华是科技 301218 是创业板');
  ok(!A.isGEM('600000'), '浦发银行 600000 不是创业板');
  ok(A.isMainOrGEM('600000'), '主板进 isMainOrGEM');
  ok(A.isMainOrGEM('300226'), '创业板进 isMainOrGEM');
  ok(!A.isMainOrGEM('688000'), '科创板不进 isMainOrGEM');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
