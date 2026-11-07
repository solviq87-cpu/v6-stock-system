// hv+1 验证：三处卡片铺满（pre 空态 / nextplan 未生成 / btResult 空态）jsdom 回放
// 只读取证，不改代码。数据源：本地 replica 真实 /api/state（pre.items=0、nextplan 全 null 的当下形态）。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = __dirname;
const TOK = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).syncUpstream.token; } catch { return ''; } })();
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

async function grab() {
  const r = await fetch('http://127.0.0.1:8787/api/state' + (TOK ? '?token=' + TOK : ''), { headers: { Connection: 'close' } });
  return r.json();
}

async function replayOnce(state, label) {
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
    await new Promise(r => setTimeout(r, 200));
  }
  const txt = id => { const el = w.document.getElementById(id); return el ? el.innerHTML : ''; };
  const box = w.document.getElementById('renderErrBox');
  const why = box && box.getAttribute('data-why');
  const out = {
    render: !!box && why === 'render', why, errs: [...new Set(errs)],
    pre: txt('preBox'), np: txt('nextplan'), bt: txt('btResult')
  };
  dom.window.close();
  return out;
}

(async () => {
  const base = await grab();
  console.log('基线: pre.items =', (base.pre || {}).items ? base.pre.items.length : 'n/a',
    '| nextplan.plan =', JSON.stringify((base.nextplan || {}).plan),
    '| ztBySector =', (base.ztBySector || []).length,
    '| ztPool =', (base.ztPool || []).length);

  // ① 真实当下形态（pre 空 + nextplan 未生成）
  const r1 = await replayOnce(base, 'real');
  console.log('\n[真实形态] render框=', r1.render, '错误=', r1.errs.length);
  r1.errs.slice(0, 3).forEach(e => console.log('   ', e.slice(0, 200)));
  const preTxt = r1.pre.replace(/<[^>]+>/g, ' ');
  const npTxt = r1.np.replace(/<[^>]+>/g, ' ');
  const btTxt = r1.bt.replace(/<[^>]+>/g, ' ');
  console.log('pre 卡含监控范围说明:', /埋伏扫描正在盯的热点板块/.test(r1.pre));
  console.log('pre 卡含真实板块名:', (base.ztBySector || []).some(g => r1.pre.includes(g.sector)));
  console.log('pre 卡解释为什么空:', /为什么一只都没有/.test(r1.pre));
  console.log('nextplan 含生成前预览:', /明日作战计划 · 生成前预览/.test(r1.np));
  console.log('nextplan 含真实涨停池票:', (base.ztPool || []).some(x => r1.np.includes(x.name)));
  console.log('nextplan 含市场环境:', /当前市场环境/.test(r1.np));
  console.log('btResult 含回测口径:', /回测口径/.test(r1.bt) && /不落盘/.test(r1.bt));
  console.log('\npre 卡文本预览:', preTxt.replace(/\s+/g, ' ').slice(0, 300));
  console.log('\nnextplan 文本预览:', npTxt.replace(/\s+/g, ' ').slice(0, 400));
  console.log('\nbtResult 文本预览:', btTxt.replace(/\s+/g, ' ').slice(0, 300));

  // ② 边界：ztBySector 空 / preselect 缺 / ztPool 空 / sectors 缺 —— 不许炸
  const st2 = JSON.parse(JSON.stringify(base));
  st2.ztBySector = []; delete st2.preselect; st2.ztPool = []; delete st2.sectors;
  const r2 = await replayOnce(st2, 'edge');
  console.log('\n[边界形态] render框=', r2.render, '错误=', r2.errs.length);
  r2.errs.slice(0, 3).forEach(e => console.log('   ', e.slice(0, 200)));
  console.log('pre 边界含"监控范围本身是空":', /监控范围本身是空/.test(r2.pre));
  console.log('nextplan 边界含"涨停池为空":', /涨停池为空/.test(r2.np));
  console.log('btResult 边界仍有口径:', /回测口径/.test(r2.bt));

  // ③ 回归：nextplan 已生成但无人过线（旧行为必须保留）
  const st3 = JSON.parse(JSON.stringify(base));
  st3.nextplan = { date: '2026-10-15', applyDate: '2026-10-16', time: '21:05:11', plan: { picked: [], count: 0 }, cand: 33, universeN: 40, missKline: 0 };
  const r3 = await replayOnce(st3, 'np-empty-plan');
  console.log('\n[已生成·无人过线] render框=', r3.render, '错误=', r3.errs.length);
  console.log('保留"宁可空仓"文案:', /宁可空仓/.test(r3.np));

  // ④ 回归：pre 有票（正常渲染路径必须不变）
  const st4 = JSON.parse(JSON.stringify(base));
  st4.pre = { time: '12:52:29', items: [{ prob: 62, name: '测试票', code: '000001', sector: '测试板块', secZT: 3, price: 10.5, pct: 2.1, mainPct: 1.2, mainInflow: 5e7, volRatio: 1.6, aboveMa5: true, amp: 20, gapToHigh20: 6, reason: '测试依据' }] };
  const r4 = await replayOnce(st4, 'pre-has-items');
  console.log('\n[pre 有票] render框=', r4.render, '错误=', r4.errs.length);
  console.log('正常渲染候选票:', /测试票/.test(r4.pre) && /埋伏依据/.test(r4.pre));
})();
