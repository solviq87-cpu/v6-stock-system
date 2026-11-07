// 侦察 · dm 轮：同一个结论，在【面板 / 推送 / 日志 / 接口返回值】四个出口下说的一致吗
// 上一轮（dl）收的是"成功有几种说法"；这一轮往外一层：系统对**用户**下的那些结论句
//   （「数据源没回来」「今日无涨停」「已送达」「候选池为空」「本轮没跑成」…）
//   在四个出口里是不是同一套措辞、同一套判据。尤其查**面板说没事、日志在报警**的错位。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const L = SV.split('\n');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');

const CJK = s => (s.match(/[\u4e00-\u9fa5]/g) || []).length;
const show = (t, n) => { console.log('\n=== ' + t + ' ==='); return n; };

// ── ① 日志侧的「结论句」：console.error / console.warn 里到底在说什么 ──
{
  show('① 日志里的中文结论（error/warn 按词频）', 0);
  const bag = {};
  L.forEach((l, i) => {
    if (l.indexOf('console.error') < 0 && l.indexOf('console.warn') < 0) return;
    const m = l.match(/console\.(error|warn)\(\s*'([^']*)'/);
    const t = m ? m[2] : '';
    if (CJK(t) >= 2) (bag[t] = bag[t] || []).push(i + 1);
  });
  const ks = Object.keys(bag).sort((a, b) => bag[b].length - bag[a].length);
  ks.slice(0, 26).forEach(k => console.log('  ' + String(bag[k].length).padStart(3) + '×  ' + k + '   L' + bag[k].slice(0, 3).join(',')));
  console.log('  （合计 ' + ks.length + ' 种说法 / ' + ks.reduce((s, k) => s + bag[k].length, 0) + ' 处）');
}

// ── ② 推送侧的「结论句」：pushLog 的 status ──
{
  show('② 推送流水里的结论（pushLog 第一参）', 0);
  const bag = {};
  L.forEach((l, i) => {
    const m = l.match(/pushLog\(\s*'([^']*)'/);
    if (m) (bag[m[1]] = bag[m[1]] || []).push(i + 1);
  });
  Object.keys(bag).sort((a, b) => bag[b].length - bag[a].length)
    .forEach(k => console.log('  ' + String(bag[k].length).padStart(3) + '×  ' + k + '   L' + bag[k].slice(0, 3).join(',')));
}

// ── ③ 接口侧的「结论」：json(res, { ok:… }) 里的 error 文案 ──
{
  show('③ 接口返回的结论文案', 0);
  const bag = {};
  L.forEach((l, i) => {
    if (!/json\(res,\s*\{[^}]*error:/.test(l)) return;
    const m = l.match(/error:\s*'([^']*)'/);
    if (m) (bag[m[1]] = bag[m[1]] || []).push(i + 1);
  });
  Object.keys(bag).sort((a, b) => bag[b].length - bag[a].length)
    .slice(0, 20).forEach(k => console.log('  ' + String(bag[k].length).padStart(3) + '×  ' + k.slice(0, 60)));
}

// ── ④ 面板侧的「结论」：index.html 里显示给用户看的判断词 ──
{
  show('④ 面板显示的结论词（出现处数）', 0);
  const WORDS = ['未就绪', '无数据', '暂无', '加载中', '失败', '已送达', '未送达', '已完成', '正常', '异常',
    '数据源', '限流', '超时', '保留上一次', '上次', '陈旧', '兜底', '未配置', '已更新', '更新于'];
  const HL = HV.split('\n');
  WORDS.forEach(w => {
    const n = HL.filter((l, i) => l.indexOf(w) >= 0 && i !== 1452).length;   // 排除 APP_VER 超长注释行
    if (n) console.log('  ' + String(n).padStart(3) + '   ' + w);
  });
}

// ── ⑤ 核心错位：日志在报警，但同一件事在内存/面板上被写成「正常」 ──
//    判据：函数块里出现 console.error（或 warn），却同时把某个 S.xxx 写成带 time 的正常态
{
  show('⑤ 错位候选：同一块里「报错 + 写正常态（带 time）」', 0);
  let hit = 0;
  for (let i = 0; i < L.length; i++) {
    if (L[i].indexOf('console.error') < 0 && L[i].indexOf('console.warn') < 0) continue;
    // 往上找函数起点
    let st = i;
    for (let j = i; j >= 0 && j > i - 90; j--) if (/^(async )?function |^\s*(async )?\w+\s*=\s*(async\s*)?\(/.test(L[j])) { st = j; break; }
    let en = i;
    for (let j = i; j < L.length && j < i + 90; j++) if (/^\}/.test(L[j])) { en = j; break; }
    const blk = L.slice(st, en + 1).join('\n');
    if (!/S\.\w+\s*=\s*\{[^}]*time/.test(blk)) continue;
    const m = blk.match(/S\.(\w+)\s*=\s*\{[^}]*time/);
    hit++;
    if (hit <= 14) console.log('  L' + (i + 1) + '  →S.' + m[1] + '   ' + L[i].trim().slice(0, 84));
  }
  console.log('  合计 ' + hit + ' 处');
}

// ── ⑥ 「接口回 ok:true」但内部其实记了失败/拦截的地方 ──
{
  show('⑥ 接口回 ok:true 的同时，pushLog 记的是失败/拦截', 0);
  const pats = ['条数闸门', '副本拦截', '未配置通道', '夜间静默', '发送失败'];
  pats.forEach(p => {
    const n = L.filter(l => l.indexOf(p) >= 0).length;
    console.log('  ' + String(n).padStart(3) + '   ' + p);
  });
}

// ── ⑦ 四出口对照：挑几个关键结论，看它在四个出口各怎么说的 ──
{
  show('⑦ 关键结论的四出口对照（同一件事的措辞）', 0);
  const CASES = [
    ['数据源没回来', ['marketReady', '未就绪', '保留上一次', '行情源']],
    ['今日无涨停', ['无涨停', 'ztPool.length', '复盘']],
    ['推送送达', ['已送达', 'pushLog', 'sent']],
    ['本轮没跑成', ['taskSet', '本轮未跑成', 'ok: false']]
  ];
  CASES.forEach(([name, kws]) => {
    console.log('  【' + name + '】');
    kws.forEach(k => {
      const ns = L.filter(l => l.indexOf(k) >= 0).length;
      const nh = HV.split('\n').filter(l => l.indexOf(k) >= 0).length;
      console.log('     ' + k.padEnd(14) + ' 日志/逻辑 ' + String(ns).padStart(3) + ' 处 ／ 面板 ' + String(nh).padStart(3) + ' 处');
    });
  });
}
