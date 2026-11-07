// hv+1 取证：面板渲染出错复现（jsdom 复刻前端调用链 + 真实 state 数据回放）
// 用户反馈「面板渲染出错问题怎么改不好」——ar/gj/gk 三轮修过仍在出现。
// 方法（gj 轮同款）：jsdom 加载线上真实首页 → 打桩 fetch 返回真实 /api/state →
//   跑 refresh() → 捕获 window.onerror / renderErrBox(data-why=render)。
// ⛔ 只读取证，不改任何代码。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = __dirname;
const TOK = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).syncUpstream.token; } catch { return ''; }
})();
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

async function grab(base, label) {
  const url = base + '/api/state' + (TOK ? '?token=' + TOK : '');
  const r = await fetch(url, { headers: { Connection: 'close' } });
  const txt = await r.text();
  let d = null;
  try { d = JSON.parse(txt); } catch {}
  console.log(`[${label}] HTTP ${r.status}，JSON 解析 ${d ? 'OK' : '失败'}，顶层字段 ${d ? Object.keys(d).length : '?'} 个`);
  return d;
}

async function replay(state, label) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || x).join(' ').slice(0, 300)));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(w) {
      w.__errored = [];
      w.addEventListener('error', ev => w.__errored.push(String(ev.message || ev.error)));
      // 打桩 fetch：所有 /api/state 返回真实数据；其它接口返回空壳避免噪音
      w.fetch = async (u) => {
        const us = String(u);
        if (us.includes('/api/state')) {
          return { ok: true, status: 200, json: async () => state, text: async () => JSON.stringify(state) };
        }
        if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
      };
      // SSE 打桩（页面启动会建 EventSource）
      w.EventSource = class { constructor() { this.onerror = null; } close() {} addEventListener() {} };
    }
  });
  const w = dom.window;
  // 等页面脚本跑完 + 手动触发几轮 refresh
  await new Promise(r => setTimeout(r, 1500));
  for (let i = 0; i < 3; i++) {
    try { if (typeof w.refresh === 'function') await w.refresh(); } catch (e) { errors.push('refresh() 抛错: ' + (e && e.stack || e)); }
    await new Promise(r => setTimeout(r, 300));
  }
  const box = w.document.getElementById('renderErrBox');
  const why = box && box.getAttribute('data-why');
  const boxText = box ? (box.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : '';
  console.log(`[${label}] renderErrBox: ${box ? '出现 data-why=' + why + ' | ' + boxText : '未出现'}`);
  if (w.__errored && w.__errored.length) console.log(`[${label}] window error 事件 ${w.__errored.length} 条:`, w.__errored.slice(0, 3));
  const uniq = [...new Set(errors)];
  if (uniq.length) {
    console.log(`[${label}] 捕获到 ${errors.length} 条错误（去重 ${uniq.length}）:`);
    for (const e of uniq.slice(0, 6)) console.log('   • ' + e.split('\n').slice(0, 4).join('\n     '));
  } else console.log(`[${label}] 无渲染错误 ✅`);
  dom.window.close();
  return { box: !!box, why, errors: uniq };
}

(async () => {
  const targets = [];
  try { const s = await grab('http://127.0.0.1:8787', '本地 replica'); if (s) targets.push([s, '本地 replica']); } catch (e) { console.log('本地拉取失败:', e.message); }
  try { const s = await grab('https://quant-dashboard-77614.app.workbuddy.host', '线上'); if (s) targets.push([s, '线上']); } catch (e) { console.log('线上拉取失败:', e.message); }
  for (const [s, label] of targets) await replay(s, label);
})();
