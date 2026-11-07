// dh 轮侦察：同一个「数据没取到」，在系统里到底有几种口径
// ① 静态：扫所有 govFilter / govTake 调用点，看传入的 items 有没有质量分字段
// ② 运行时：直接问本机 8787 的真实状态，各池子里究竟有多少"取不到分"的票
const http = require('http');
const fs = require('fs');
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV);

// ── ① 静态：所有 govFilter 调用点 + 传入的 items 变量名 ──────────────────
console.log('【① govFilter 调用点】');
const re = /govFilter\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)/g;
let m;
while ((m = re.exec(SVS))) {
  console.log('   type=' + m[1].padEnd(12) + ' items=' + m[2]);
}

// ── ② 运行时：本机 8787 的真实状态 ──────────────────────────────────────
function get(path) {
  return new Promise(res => {
    const r = http.request({ host: '127.0.0.1', port: 8787, path, method: 'GET' }, x => {
      let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(null); } });
    });
    r.on('error', () => res(null));
    r.end();
  });
}
// probAt 的判定顺序（与 server.js 保持一致）
const probAt = x => {
  if (!x) return undefined;
  if (x.prob != null) return x.prob;
  if (x.riseProb != null) return x.riseProb;
  if (x.score != null) return x.score;
  if (x.trendScore != null) return x.trendScore;
  return undefined;
};

(async () => {
  const s = await get('/api/state');
  if (!s) { console.log('\n【② 运行时】本机 8787 未就绪，跳过'); return; }
  console.log('\n【② 运行时：各池子里「取不到质量分」的票】');
  const POOLS = [
    ['精选池 pool', (s.pool || {}).items || s.pool || []],
    ['趋势池 trend', (s.trend || {}).items || s.trend || []],
    ['大单 bigmoney', (s.bigMoney || {}).items || []],
    ['相似 similar', (s.similar || {}).items || []],
    ['补涨龙 buzhang', (s.buzhang || {}).items || []],
    ['启动前埋伏 pre', (s.pre || {}).items || []],
    ['涨停前 ztPre', (s.ztPre || {}).items || []],
    ['趋势扫描 trendScan', s.trendScan || []],
    ['连续收涨 steadyUp', s.steadyUp || []]
  ];
  for (const [name, arr] of POOLS) {
    const list = Array.isArray(arr) ? arr : [];
    const miss = list.filter(x => probAt(x) === undefined);
    const keys = list.length ? [...new Set(list.flatMap(x => Object.keys(x)))].filter(k => /prob|score|rise/i.test(k)) : [];
    console.log('   ' + name.padEnd(20) + ' 共 ' + String(list.length).padStart(3) +
      ' 只，取不到分 ' + String(miss.length).padStart(3) + ' 只' +
      '　候选分字段名: ' + (keys.join('/') || '（一个都没有）'));
  }
  console.log('\n【③ 对照：项目既定原则】');
  console.log('   L3203 注释：「判不出来」≠「判了通过」…… 硬闸门证据不足时唯一诚实的做法是「说清楚没判」，而不是默许放行');
  console.log('   govTake 实际：if (prob != null && …) → prob 为 undefined 时整条跳过 = 默许放行');
  console.log('   _p 排序实际：if (!Number.isFinite(v)) return -1 → 取不到分排最末尾 = 按最差处理');
  console.log('   ⛔ 同一个「取不到分」，排序按最差、闸门按通过 —— 两个相反的语义');
})();
