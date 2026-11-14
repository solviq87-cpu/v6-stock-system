// 输入防丢机制验证：事故回放「用户打了大量字 → 点发送 → 全没了」
// 把 index.html 里的真实源码抽出来，用 mock DOM 跑，确保测试与实现不跑偏。
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

// 抽出防丢代码块（从 DRAFT_KEY 常量到 applyUpdate 函数体结束）
function findFuncEnd(src, startIdx) {
  let i = src.indexOf('{', startIdx);
  if (i < 0) return -1;
  let depth = 1;
  for (i++; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  return i;
}
const a = html.indexOf("const DRAFT_KEY =");
const b = html.indexOf('function applyUpdate()');
const bEnd = findFuncEnd(html, b);
if (a < 0 || bEnd < 0) { console.error('❌ 未找到防丢代码块'); process.exit(1); }
const SRC = html.slice(a, bEnd);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ---- mock DOM ----
function mkDom(fields) {
  const els = fields.map(f => ({
    id: f.id, value: f.value || '', tagName: f.tag, type: f.type,
    attrs: f, _v: f.value || '',
    get value() { return this._v; }, set value(x) { this._v = x; },
    matches: () => true
  }));
  const store = {};
  return {
    els,
    document: {
      getElementById: id => els.find(e => e.id === id) || null,
      querySelectorAll: sel => {
        // 只认 draftSel 用的选择器：非 password / 非 checkbox / 非 radio 的 input + textarea
        if (sel.indexOf('textarea') >= 0 || sel.indexOf('input') >= 0) {
          return els.filter(e => {
            // ⚠️ 用 tagName（真实 DOM 的属性名），别写成自定义的 tag —— 否则全被过滤掉
            if (e.tagName !== 'INPUT' && e.tagName !== 'TEXTAREA') return false;
            if (e.type === 'password' || e.type === 'checkbox' || e.type === 'radio') return false;
            return true;
          });
        }
        return [];
      },
      activeElement: null,
      createElement: () => ({ style: {}, className: '', innerHTML: '' }),
      body: { insertBefore() { }, firstChild: null },
      addEventListener() { },
      readyState: 'complete'
    },
    localStorage: {
      _d: store,
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    window: { addEventListener() { } }
  };
}

// checkAppVer 里用到的运行时状态
function mkWorld(fields, opts = {}) {
  const d = mkDom(fields);
  const st = { reload: 0, barHtml: '', hidden: false };
  const api = new Function('document', 'localStorage', 'window', 'location', 'fetch', 'console', 'APP_VER',
    `${SRC}
     return { draftSnap, draftHas, draftRestore, draftDiscard, checkAppVer, applyUpdate, topBar, hideTopBar, draftSel };`
  )(
    Object.assign(d.document, { activeElement: opts.focus || null }),
    d.localStorage, d.window,
    { href: 'http://127.0.0.1/', reload() { st.reload++; }, replace() { st.reload++; } },
    async () => ({ json: async () => ({ appVer: opts.serverVer || '20260927zz' }) }),
    { log() { } },
    opts.clientVer || '20260927be'
  );
  return { api, st, ...d };
}

(async () => {

console.log('\n① 草稿实时落盘 —— 你打的字立刻进本机存储');
{
  const { api, localStorage: LS } = mkWorld([
    { id: 'hNote', tag: 'INPUT', value: '这是我打的一大段备注' },
    { id: 'srcEdit', tag: 'TEXTAREA', value: 'console.log(一大段代码)' },
    { id: 'hCode', tag: 'INPUT', value: '' }
  ]);
  api.draftSnap();
  const raw = LS.getItem('qd_draft_v1');
  ok('有内容时写入 localStorage', !!raw);
  const d = JSON.parse(raw).d;
  ok('文本框内容被完整保存', d.hNote === '这是我打的一大段备注', String(d.hNote));
  ok('大文本域（源码编辑器）也被保护', d.srcEdit === 'console.log(一大段代码)');
  ok('空输入框不进草稿（避免回填出空串鸡肋）', !('hCode' in d));
  ok('draftHas 报告草稿数量', api.draftHas() === 2, String(api.draftHas()));
}

console.log('\n② 安全红线 —— 密码绝不能明文落盘');
{
  const { api, localStorage: LS } = mkWorld([
    { id: 'lockPwd', tag: 'INPUT', type: 'password', value: 'QDDEV26KT99' },
    { id: 'viewPwd', tag: 'INPUT', type: 'password', value: 'QD410816' },
    { id: 'hNote', tag: 'INPUT', value: '备注可以存' }
  ]);
  api.draftSnap();
  const raw = LS.getItem('qd_draft_v1') || '{}';
  ok('开发者密码没有出现在草稿里', raw.indexOf('QDDEV26KT99') < 0);
  ok('观看密码没有出现在草稿里', raw.indexOf('QD410816') < 0);
  ok('非敏感字段照常保存', raw.indexOf('备注可以存') >= 0);
}

console.log('\n③ 事故回放 —— 正在输入时遇到版本更新，不能刷新');
{
  // 事故当天的情形：用户框里有字 + 服务端已换版本
  const { api, st } = mkWorld([{ id: 'hNote', tag: 'INPUT', value: '打了一半的一大段字' }], { serverVer: '20260927bj' });
  api.draftSnap();
  const r = await api.checkAppVer();
  ok('检测到版本不一致时【没有】强制刷新（字不会被冲掉）', st.reload === 0, 'reload=' + st.reload);
  ok('返回 false，登录与渲染流程照常继续', r === false, String(r));
}

console.log('\n④ 焦点在输入框里 —— 同样不许打断');
{
  const focus = { tagName: 'TEXTAREA', id: 'srcEdit' };
  const { api, st } = mkWorld([{ id: 'srcEdit', tag: 'TEXTAREA', value: '正在打字' }], { focus, serverVer: '20260927bj' });
  api.draftSnap();
  await api.checkAppVer();
  ok('用户焦点在输入区时不刷新', st.reload === 0, 'reload=' + st.reload);
}

console.log('\n⑤ 页面干净没有其他输入 —— 恢复原来的自动更新');
{
  const { api, st } = mkWorld([{ id: 'hCode', tag: 'INPUT', value: '' }], { serverVer: '20260927bj' });
  const res = await api.checkAppVer();
  ok('空页面照旧刷新到最新版（不牺牲更新及时性）', st.reload === 1, 'reload=' + st.reload);
  ok('并返回 true 阻断后续流程', res === true);
}

console.log('\n⑥ 草稿恢复 —— 只填空框，绝不覆盖服务端已下发的内容');
{
  const { api, els, localStorage: LS } = mkWorld([
    { id: 'hName', tag: 'INPUT', value: '' },
    { id: 'srcEdit', tag: 'TEXTAREA', value: '' }
  ]);
  LS.setItem('qd_draft_v1', JSON.stringify({ ts: Date.now(), d: { hName: '我打的名字', srcEdit: '我之前的代码' } }));
  const n = api.draftRestore();
  const nm = els.find(e => e.id === 'hName').value;
  ok('空白处被回填', n === 2, '恢复 ' + n + ' 处');
  ok('回填内容与原输入一致', nm === '我打的名字', String(nm));
}

console.log('\n⑦ 关键坑：不能覆盖服务端内容');
{
  const w = mkWorld([{ id: 'srcEdit', tag: 'TEXTAREA', value: '服务端下发的源码' }]);
  w.localStorage.setItem('qd_draft_v1', JSON.stringify({ ts: Date.now(), d: { srcEdit: '我旧的草稿' } }));
  const n = w.api.draftRestore();
  ok('框里已有服务端内容时，草稿【不】覆盖', n === 0, '回填了 ' + n + ' 处');
  ok('服务端内容原封不动', w.els.find(e => e.id === 'srcEdit').value === '服务端下发的源码');
}

setTimeout(() => {
  console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
  process.exit(fail ? 1 : 0);
}, 200);

})();
