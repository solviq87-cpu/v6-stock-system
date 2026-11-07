// 卡片铺满守门测试（hv+1 轮，2026-10-15）
// ── 为什么单立一个套件 ────────────────────────────────────────────────
// 用户反馈「卡片那么多留空的铺满」。取证（_forensic_cards.js + jsdom 回放）确认三张空置卡：
//   ① 🌱 板块效应·启动前埋伏：items=0 时只有一行小字 + 420px 大白片；
//   ② 次日作战计划：15:45 前全 null，只有一行小字 + 820px 大白片；
//   ③ 两个月回测：用户点「运行回测」前 btResult 整片空白。
// 修法（全部前端、⛔ 不动任何后端系数与推送闸门）：空态改为「有意义的占位」——
//   pre 空态摆「扫描正在盯的热点板块」（ztBySector/sectors 现成数据）+ 为什么空的三种解释；
//   nextplan 未生成摆「生成前预览」（今日涨停池=候选来源 + 评分口径 + 市场环境）；
//   btResult 空态摆「回测口径」说明（并注明结果不落盘、刷新后会重新变空）。
// 本套件钉死：a) 空态必须铺满且只摆真数据；b) 旧行为不许回归（宁可空仓文案 / 有票时的正常渲染）；
//   c) 边界数据（ztBySector 空 / preselect 缺 / ztPool 空 / sectors 缺）不许抛错；
//   d) 外部文本（板块名/股名）必须 esc() 后才进 innerHTML（XSS 入口）。
const fs = require('fs');
const path = require('path');
// jsdom 解析：本机受管 workspace（NODE_PATH 指向处）优先，其次按普通 node_modules 找。
// ⛔ _runall.js 批量跑时不带 NODE_PATH，直接 require('jsdom') 会崩 → 整册假红，
//    所以这里做双路解析（与 _forensic_render*.js 同一份 jsdom，行为一致）。
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (_) {
  ({ JSDOM, VirtualConsole } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom'));
}

const ROOT = __dirname;
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};

// 合成 state：只放三张卡要用的字段，其余一律不放 ——
// gj/hv+1 轮的字段级韧性修复保证缺字段不抛错（这正是本套件的前提，顺带再证一次）。
function mkState(over) {
  const base = {
    ztBySector: [
      { sector: '算力·存储', count: 6, stocks: [{ name: '澳弘电子', lb: 1, role: 'leader' }, { name: '天津普林', lb: 1, role: 'mid' }] },
      { sector: '传媒', count: 2, stocks: [{ name: '慈文传媒', lb: 5, role: 'leader' }] }
    ],
    sectors: [
      { name: '算力·存储', pct: 3.2, mainInflow: 5.2e8 },
      { name: '传媒', pct: -0.8, mainInflow: -1.1e7 }
    ],
    ztPool: [
      { code: '002815', name: '崇达技术', price: 23.25, pct: 9.98, limitUpCount: 1, sealAmount: 1.12e9, breakCount: 0, sector: '算力·存储' },
      { code: '002343', name: '慈文传媒', price: 12.1, pct: 9.99, limitUpCount: 5, sealAmount: 3.4e8, breakCount: 1, sector: '传媒' }
    ],
    preselect: { time: '11:30:24', mood: { mood: '偏冷', upN: 480, downN: 5054, ztN: 39, dtN: 18, avgPct: -2.16 } },
    mood: { mood: '偏冷', upN: 480, downN: 5054, ztN: 39, dtN: 18, avgPct: -2.16 }, // ⛔ ie 轮：后端 /api/state 独立下发 mood（与 preselect 解耦），测试桩同步
    mainline: { time: '12:52:29', items: [{ sector: '算力·存储', count: 6, maxLb: 1, lbSum: 6 }] },
    pre: { time: '12:52:29', items: [] },
    nextplan: { date: null, applyDate: null, time: null, plan: null, text: null, cand: 0, universeN: 0, missKline: 0 }
  };
  return Object.assign(base, over || {});
}

async function replayOnce(state) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/navigation to another Document/.test(m)) errs.push(m); });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u) => {
        const us = String(u);
        if (us.includes('/api/state')) return { ok: true, status: 200, json: async () => state, text: async () => JSON.stringify(state) };
        if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
      };
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
    }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 800));
  for (let i = 0; i < 2; i++) {
    try { if (typeof w.refresh === 'function') await w.refresh(); } catch (e) { errs.push('refresh 抛错: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    await new Promise(r => setTimeout(r, 150));
  }
  const txt = id => { const el = w.document.getElementById(id); return el ? el.innerHTML : ''; };
  const box = w.document.getElementById('renderErrBox');
  const out = {
    render: !!box && box.getAttribute('data-why') === 'render',
    errs: [...new Set(errs)],
    pre: txt('preBox'), np: txt('nextplan'), bt: txt('btResult'),
    setBt: html => { const el = w.document.getElementById('btResult'); if (el) el.innerHTML = html; }
  };
  dom.window.close();
  return out;
}

(async () => {
  // ── ① pre 空态铺满 ──
  const r1 = await replayOnce(mkState());
  ok('pre 空态：0 render 错误 / 0 jsdom 错误', !r1.render && r1.errs.length === 0, r1.errs[0] || '');
  ok('pre 空态：含「扫描正在盯的热点板块」标题', /埋伏扫描正在盯的热点板块/.test(r1.pre));
  ok('pre 空态：含取数口径（涨停≥2家或1家≥2连板/板块涨≥2%）', /取数口径/.test(r1.pre));
  ok('pre 空态：摆出真实热点板块（算力·存储 涨停6家）', /算力·存储<\/b> 涨停6家/.test(r1.pre));
  ok('pre 空态：摆出龙头与连板高度（慈文传媒 5板）', /慈文传媒/.test(r1.pre) && /最高5板/.test(r1.pre));
  ok('pre 空态：解释为什么空（三种原因）', /为什么一只都没有/.test(r1.pre) && /要么还没动/.test(r1.pre));
  ok('pre 空态：不再是一行小字（内容长度>200）', r1.pre.length > 200);

  // ── ② pre 边界：ztBySector 空 ──
  const r2 = await replayOnce(mkState({ ztBySector: [] }));
  ok('pre 边界（ztBySector 空）：不抛错', !r2.render && r2.errs.length === 0, r2.errs[0] || '');
  ok('pre 边界：明说「监控范围本身是空」', /监控范围本身是空/.test(r2.pre));

  // ── ③ pre 回归：有票时正常渲染 ──
  const r3 = await replayOnce(mkState({ pre: { time: '12:52:29', items: [{ prob: 62, name: '测试票', code: '000001', sector: '测试板块', secZT: 3, price: 10.5, pct: 2.1, mainPct: 1.2, mainInflow: 5e7, volRatio: 1.6, aboveMa5: true, amp: 20, gapToHigh20: 6, reason: '测试依据' }] } }));
  ok('pre 有票：0 错误', !r3.render && r3.errs.length === 0, r3.errs[0] || '');
  ok('pre 有票：正常渲染候选票与埋伏依据', /测试票/.test(r3.pre) && /埋伏依据/.test(r3.pre));
  ok('pre 有票：不出现空态铺满文案', !/埋伏扫描正在盯的热点板块/.test(r3.pre));

  // ── ④ nextplan 未生成：生成前预览 ──
  ok('nextplan 未生成：0 render 错误 / 0 jsdom 错误', !r1.render && r1.errs.length === 0, r1.errs[0] || '');
  ok('nextplan 未生成：含「生成前预览」', /明日作战计划 · 生成前预览/.test(r1.np));
  ok('nextplan 未生成：含 55 分门槛口径', /≥55 分/.test(r1.np) && /板块\/资金\/量比\/技术\/纪律/.test(r1.np));
  ok('nextplan 未生成：候选池=今日涨停池（首板/连板/最高板数真实）', /今日涨停池 2 只：首板 1 \/ 连板 1，最高 5 板/.test(r1.np));
  ok('nextplan 未生成：摆出真实候选票（按封单前5，慈文传媒）', /慈文传媒/.test(r1.np));
  ok('nextplan 未生成：声明「只是评估范围不是推荐」', /只是评估范围，不是推荐/.test(r1.np));
  ok('nextplan 未生成：含市场环境（情绪偏冷·涨480/跌5054）', /情绪<b>偏冷<\/b>/.test(r1.np) && /涨480\/跌5054/.test(r1.np));
  ok('nextplan 未生成：主线取自主力归并（算力·存储(6板)）', /算力·存储\(6板\)/.test(r1.np));
  ok('nextplan 未生成：保留「尚未生成」原始提示行', /尚未生成。收盘后 15:45/.test(r1.np));

  // ── ⑤ nextplan 边界：ztPool 空 / preselect 缺 ──
  const r5 = await replayOnce(mkState({ ztPool: [], preselect: {}, mood: null }));
  ok('nextplan 边界（涨停池空）：不抛错', !r5.render && r5.errs.length === 0, r5.errs[0] || '');
  ok('nextplan 边界：明说「涨停池为空」', /涨停池为空/.test(r5.np));
  ok('nextplan 边界：情绪数据缺失时不编造', /情绪数据未就绪/.test(r5.np));

  // ── ⑥ nextplan 回归：已生成但无人过线（旧文案必须保留）──
  const r6 = await replayOnce(mkState({ nextplan: { date: '2026-10-15', applyDate: '2026-10-16', time: '21:05:11', plan: { picked: [], count: 0 }, cand: 2, universeN: 40, missKline: 0 } }));
  ok('nextplan 已生成·无人过线：0 错误', !r6.render && r6.errs.length === 0, r6.errs[0] || '');
  ok('nextplan 已生成·无人过线：保留「宁可空仓，也不凑数」', /宁可空仓，也不凑数/.test(r6.np));
  ok('nextplan 已生成·无人过线：不出现生成前预览（已有真实计划结论）', !/生成前预览/.test(r6.np));

  // ── ⑦ nextplan 回归：有票时正常渲染 ──
  const r7 = await replayOnce(mkState({ nextplan: { date: '2026-10-15', applyDate: '2026-10-16', time: '21:05:11', plan: { picked: [{ score: 72, name: '计划票', code: '600000', grade: 'A', sector: '算力·存储', price: 10, entry: [9.8, 10.1], stop: 9.4, target: 11.2, reasons: ['理由一'], invalid: ['失效一'], confirm: ['验证一'] }], count: 1 }, cand: 2, universeN: 40, missKline: 0 } }));
  ok('nextplan 有票：0 错误', !r7.render && r7.errs.length === 0, r7.errs[0] || '');
  ok('nextplan 有票：正常渲染计划票（72分+进场/止损/目标）', /计划票/.test(r7.np) && /72分/.test(r7.np) && /止损/.test(r7.np));

  // ── ⑧ btResult 空态铺满 ──
  ok('btResult 空态：0 错误', !r1.render && r1.errs.length === 0, r1.errs[0] || '');
  ok('btResult 空态：含回测口径（40 个交易日逐日回放）', /回测口径/.test(r1.bt) && /40 个交易日/.test(r1.bt));
  ok('btResult 空态：注明结果不落盘、刷新会变空', /不落盘/.test(r1.bt) && /刷新页面后这里会重新变空/.test(r1.bt));
  ok('btResult 空态：含「不构成投资建议」', /不构成投资建议/.test(r1.bt));
  ok('btResult 空态：不再整片空白（内容长度>100）', r1.bt.length > 100);

  // ── ⑨ btResult 有结果后不被占位覆盖 ──
  const r9 = await replayOnce(mkState());
  r9.setBt('<b>已有回测结果</b>');
  // 上面 setBt 的当场值在 dom 关闭后已失效，真正验覆盖问题走下面独立 dom：
  const vc2 = new VirtualConsole();
  const dom2 = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc2,
    beforeParse(w) {
      w.fetch = async (u) => {
        const us = String(u);
        if (us.includes('/api/state')) return { ok: true, status: 200, json: async () => mkState(), text: async () => '{}' };
        if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
      };
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
    }
  });
  const w2 = dom2.window;
  await new Promise(r => setTimeout(r, 800));
  await w2.refresh();
  const bt2 = w2.document.getElementById('btResult');
  bt2.innerHTML = '<b>已有回测结果</b>';
  await w2.refresh();
  const kept = /已有回测结果/.test(bt2.innerHTML);
  dom2.window.close();
  ok('btResult 已有结果：刷新后占位不覆盖（结果不落盘是设计，但当场不许被擦）', kept);

  // ── ⑩ XSS：外部文本必须 esc ──
  const rX = await replayOnce(mkState({
    ztBySector: [{ sector: '<img src=x onerror=window.__xss=1>', count: 6, stocks: [{ name: '<b>坏票</b>', lb: 1, role: 'leader' }] }],
    ztPool: [{ code: '1', name: '<script>window.__xss2=1</script>', price: 1, pct: 9, limitUpCount: 1, sealAmount: 1, breakCount: 0, sector: '<i>坏板块</i>' }]
  }));
  ok('XSS：板块名/股名转义后进 innerHTML（无裸 <img onerror>）', !/<img src=x onerror=/.test(rX.pre) && !/<script>window\.__xss2/.test(rX.np));
  ok('XSS：0 render 错误', !rX.render && rX.errs.length === 0, rX.errs[0] || '');

  console.log(`\n===== 汇总: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('套件崩溃:', e); process.exit(1); });
