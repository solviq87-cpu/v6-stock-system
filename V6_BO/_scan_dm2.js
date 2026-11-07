// 侦察 · dm 轮第二遍：同一个「这份数据不新鲜」的结论，在系统里有几种写法、几个出口看得见
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const L = SV.split('\n');
const HL = HV.split('\n');

console.log('=== ① 「陈旧 / 兜底 / 上次结果」的写法清单 ===');
['stale', 'Stale', '陈旧', '兜底', '上一次', '上次', 'fresh', 'Fresh', 'ago', 'expired', 'ttl', 'TTL'].forEach(k => {
  const ls = L.map((l, i) => l.indexOf(k) >= 0 ? (i + 1) : 0).filter(Boolean);
  if (ls.length) console.log('  ' + k.padEnd(8) + ' ' + String(ls.length).padStart(3) + ' 处  L' + ls.slice(0, 8).join(','));
});

console.log('\n=== ② stale 类字段：定义处 / 是否随 S.xxx 下发 / 面板有没有读 ===');
{
  const fields = new Set();
  L.forEach(l => {
    const m = l.match(/\b(\w*[Ss]tale\w*)\s*[:=]/g);
    if (m) m.forEach(x => fields.add(x.replace(/[:=]/g, '').trim()));
  });
  [...fields].sort().forEach(f => {
    const ns = L.filter(l => l.indexOf(f) >= 0).length;
    const nh = HL.filter(l => l.indexOf(f) >= 0 && l.indexOf('APP_VER') < 0).length;
    console.log('  ' + f.padEnd(18) + ' 逻辑 ' + String(ns).padStart(3) + ' 处 ／ 面板 ' + String(nh).padStart(2) + ' 处' + (nh ? '' : '   ⛔ 面板看不见'));
  });
}

console.log('\n=== ③ 各结果池：数据源没回来时保留了上次结果，面板显示什么 ===');
{
  const POOLS = ['bigMoney', 'pre', 'buzhang', 'myrules', 'nextplan', 'steadyUp', 'trendScan', 'ztPool', 'candidatePool', 'review', 'sectors', 'breadth'];
  POOLS.forEach(p => {
    // 找 S.p = { ... time ... } 的赋值
    const asg = L.map((l, i) => new RegExp('S\\.' + p + '\\s*=\\s*\\{').test(l) ? i + 1 : 0).filter(Boolean);
    const hasTime = asg.filter(n => /time/.test(L[n - 1]));
    const hasStale = asg.filter(n => /stale|Stale/.test(L[n - 1]));
    const panelTime = HL.filter(l => l.indexOf('s.' + p) >= 0 && /time|更新于/.test(l)).length;
    console.log('  S.' + p.padEnd(14) + ' 赋值 ' + String(asg.length).padStart(2) + ' 处（带 time ' + hasTime.length + '／带 stale ' + hasStale.length + '）' +
      ' ／ 面板显示时间 ' + panelTime + ' 处' + (hasTime.length && !hasStale.length ? '   ⛔ 有时刻没新鲜度标记' : ''));
  });
}

console.log('\n=== ④ marketReady() 的判据与出口 ===');
{
  const idx = SV.indexOf('function marketReady');
  if (idx > 0) {
    let en = SV.indexOf('\n}', idx);
    console.log('  ' + SV.slice(idx, en + 2).replace(/\n/g, '\n  '));
  }
  const calls = L.map((l, i) => l.indexOf('marketReady()') >= 0 ? i + 1 : 0).filter(Boolean);
  console.log('  调用点 ' + calls.length + ' 处：L' + calls.join(','));
  console.log('  面板侧 marketReady / 未就绪 出现：' + HL.filter(l => /marketReady|未就绪/.test(l)).length + ' 处');
}

console.log('\n=== ⑤ 面板上「更新于 XX:XX」这类陈述有几处、有没有带新鲜度 ===');
{
  HL.forEach((l, i) => {
    if (l.indexOf('更新于') >= 0 || /时间.*time|\.time\b/.test(l)) {
      const t = l.trim().slice(0, 110);
      if (t.length > 8) console.log('  L' + (i + 1) + '  ' + t);
    }
  });
}

console.log('\n=== ⑥ 日志里说「数据源没回来」的地方（用户侧有没有对应出口） ===');
{
  L.forEach((l, i) => {
    if (/未就绪|没回来|没拉到|行情源|数据源/.test(l) && /console\./.test(l)) {
      console.log('  L' + (i + 1) + '  ' + l.trim().slice(0, 120));
    }
  });
}
