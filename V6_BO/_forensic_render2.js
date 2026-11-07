// hv+1 取证②：面板渲染出错的数据形态定位（jsdom + 真实数据 + 字段级模糊测试）
// 正常完整数据回放不抛错（_forensic_render.js 已验证）→ 问题在特定数据形态。
// 本轮系统化扫三类形态：
//   A. locked 响应（未登录/私密闸门时 /api/state 返回 {locked:true}）——ar/gj/gk 都没修过这个进渲染的路径
//   B. 顶层字段逐个置 null / 删除
//   C. 数组字段逐个：置 [] / 置 [null] / 置 [{}]
// ⛔ 只读取证，不改代码。
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
  const box = w.document.getElementById('renderErrBox');
  const why = box && box.getAttribute('data-why');
  dom.window.close();
  return { render: !!box && why === 'render', why, errs: [...new Set(errs)] };
}

(async () => {
  const base = await grab();
  console.log('基线字段数:', Object.keys(base).length);
  const findings = [];

  // A. locked 形态
  for (const [label, st] of [
    ['locked 纯响应', { locked: true, needPassword: true, reason: 'none', msg: '该设备需验证口令后才能查看数据' }],
    ['空对象', {}],
    ['locked+loginGate', { locked: true, needPassword: true, showLogin: true }],
  ]) {
    const r = await replayOnce(st, label);
    if (r.render || r.errs.length) findings.push({ label, ...r });
    console.log(`A[${label}] render框=${r.render} 错误=${r.errs.length}`);
  }

  // B/C. 字段级模糊
  const keys = Object.keys(base);
  for (const k of keys) {
    const v = base[k];
    const variants = [];
    variants.push(['置null', null]);
    variants.push(['删除', '__DEL__']);
    if (Array.isArray(v)) { variants.push(['置空数组', []]); variants.push(['置[null]', [null]]); variants.push(['置[{}]', [{}]]); }
    for (const [tag, val] of variants) {
      const st = JSON.parse(JSON.stringify(base));
      if (val === '__DEL__') delete st[k]; else st[k] = val;
      const r = await replayOnce(st, `${k}.${tag}`);
      if (r.render || r.errs.length) {
        findings.push({ label: `${k}.${tag}`, ...r });
        console.log(`💥 [${k}] ${tag}: render框=${r.render} why=${r.why || '-'} 错误=${r.errs.length}`);
        for (const e of r.errs.slice(0, 2)) console.log('      ' + e.slice(0, 260));
      }
    }
  }
  console.log('\n===== 汇总 =====');
  console.log('问题形态数:', findings.length);
  const byKey = {};
  for (const f of findings) { const k = f.label.split('.')[0]; (byKey[k] = byKey[k] || []).push(f.label); }
  for (const k of Object.keys(byKey)) console.log(' ', k, '→', byKey[k].join(', '));
})();
