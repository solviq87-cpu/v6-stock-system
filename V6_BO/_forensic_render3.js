// hv+1 取证③：数组含 null 元素的渲染抛错 stack 定位
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = __dirname;
const TOK = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).syncUpstream.token; } catch { return ''; } })();
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/state' + (TOK ? '?token=' + TOK : ''), { headers: { Connection: 'close' } });
  const base = await r.json();
  const st = JSON.parse(JSON.stringify(base));
  st.pool = [null];   // 已证实炸的形态

  const consoleErrs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => consoleErrs.push('jsdomError: ' + String(e && e.stack || e).slice(0, 800)));
  vc.on('error', (...a) => consoleErrs.push('vc.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 800)));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(w) {
      const origErr = w.console.error.bind(w.console);
      w.console.error = (...a) => { consoleErrs.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 800)); origErr(...a); };
      w.__onerror = [];
      w.addEventListener('error', ev => w.__onerror.push(String((ev.error && ev.error.stack) || ev.message).slice(0, 800)));
      w.fetch = async (u) => {
        const us = String(u);
        if (us.includes('/api/state')) return { ok: true, status: 200, json: async () => st, text: async () => JSON.stringify(st) };
        if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
      };
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
    }
  });
  const w = dom.window;
  await new Promise(r2 => setTimeout(r2, 800));
  try { await w.refresh(); } catch (e) { consoleErrs.push('refresh throw: ' + String(e && e.stack || e).slice(0, 800)); }
  await new Promise(r2 => setTimeout(r2, 300));
  const box = w.document.getElementById('renderErrBox');
  console.log('renderErrBox:', box ? box.getAttribute('data-why') : '未出现');
  console.log('\n===== window error 事件 =====');
  for (const e of (w.__onerror || [])) console.log(e.slice(0, 600));
  console.log('\n===== console.error / jsdomError =====');
  for (const e of consoleErrs.slice(0, 6)) { console.log('---'); console.log(e.slice(0, 600)); }
  dom.window.close();
})();
