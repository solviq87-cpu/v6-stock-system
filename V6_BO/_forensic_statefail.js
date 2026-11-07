// dy 轮取证（第三版）：验证「一次请求挂住」之后能不能自愈
// 场景 C1：请求挂住但响应 AbortController → 12 秒超时算失败，恢复正常后摘框
// 场景 C2：请求挂住且完全不响应 abort（最坏环境）→ 25 秒兜底放行，恢复后摘框
// 场景 A ：失败 3 轮后恢复 → 摘框（回归，确认没改坏）
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const ROOT = __dirname;
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const TOK = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).syncUpstream.token; } catch { return ''; } })();
let REAL = null;

function mkDom(fetchImpl) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => { const s = String((e && e.stack) || e); if (!/navigation to another Document/.test(s)) errs.push(s.slice(0, 240)); });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fetchImpl;
      w.setInterval = () => 0;          // 关掉页面自身的 5 秒轮询，由脚本单步驱动
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
      w.navigator.sendBeacon = () => true;
      w.addEventListener('error', ev => errs.push('window.onerror: ' + String((ev.error && ev.error.stack) || ev.message).slice(0, 700)));
    }
  });
  return { dom, w: dom.window, errs };
}
const okState = () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(REAL)), text: async () => '{}' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(name, seq, gapMs) {
  let i = 0;
  const impl = async (u, opt) => {
    const us = String(u);
    if (us.includes('/api/state')) {
      const step = seq[Math.min(i, seq.length - 1)]; i++;
      if (step === 'fail') throw new TypeError('Failed to fetch');
      if (step === 'hang-abusable') {
        // 真实 fetch 的行为：signal abort 时以 AbortError 拒绝
        return new Promise((_, rej) => {
          const sig = opt && opt.signal;
          if (sig) sig.addEventListener('abort', () => rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
        });
      }
      if (step === 'hang-dead') return new Promise(() => {});   // 连 abort 都不理（最坏环境）
      return okState();
    }
    if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
  };
  const { w, errs } = mkDom(impl);
  await sleep(500);
  const box = () => w.document.getElementById('renderErrBox');
  const line = (tag) => {
    const b = box();
    return `${tag} → box=${b ? b.getAttribute('data-why') : '无'}${b ? ' 「' + (b.textContent || '').replace(/\s+/g, ' ').slice(0, 62) + '」' : ''}`;
  };
  const out = [line('加载后')];
  for (let k = 0; k < seq.length; k++) {
    const t0 = Date.now();
    const p = Promise.race([w.refresh().catch(e => 'throw:' + e.message), sleep(gapMs)]);
    const r = await p;
    out.push(line(`第${k + 1}轮[${seq[k]}] 耗时${Date.now() - t0}ms${r ? ' (' + String(r).slice(0, 24) + ')' : ''}`));
  }
  console.log('=== ' + name + ' ===');
  console.log(out.join('\n'));
  if (errs.length) console.log('  [页面错误] ' + errs.slice(0, 2).join(' || '));
  w.close();
}

(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/state' + (TOK ? '?token=' + TOK : ''), { headers: { Connection: 'close' } });
  REAL = await r.json();
  console.log('真实 state 字段数=' + Object.keys(REAL).length);
  await run('A 失败3轮后恢复（回归）', ['fail', 'fail', 'fail', 'ok', 'ok'], 6000);
  await run('C1 挂住但会响应 abort → 12s 超时 + 恢复摘框', ['fail', 'fail', 'fail', 'hang-abusable', 'ok'], 14000);
  await run('C2 挂住且不响应 abort → 25s 兜底放行 + 恢复摘框', ['fail', 'fail', 'fail', 'hang-dead', 'ok'], 27000);
})();
