// hv+1 取证④：面板卡片空置盘点（用户「卡片那么多留空的铺满」）
// 拉线上真实 /api/state，逐个面板区块核对数据量，列出空置卡片 + 空的原因分类。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const TOK = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).syncUpstream.token; } catch { return ''; } })();

(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/state' + (TOK ? '?token=' + TOK : ''), { headers: { Connection: 'close' } });
  const s = await r.json();
  const H = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

  // 面板区块 → 数据字段（从 renderPanel 各 Box 的取数归纳）
  const CARDS = [
    ['涨停池', 'ztPool'], ['精选池', 'pool'], ['板块异动', 'sectors'], ['板块资金', 'sectFlow'],
    ['趋势扫描', 'trendScan'], ['连涨', 'steadyUp'], ['涨停前形态', 'ztPre'], ['补涨龙', 'buzhang'],
    ['大单流入', 'bigmoney'], ['相似走势', 'similar'], ['竞价强势', 'auction'],
    ['一进二', 'yierList'], ['连板接力', 'lianbanList'], ['涨停复盘', 'ztBySector'],
    ['题材归纳', 'ztTopics'], ['自检/信号', 'signals'], ['学习历史', 'learnHistory'],
    ['外围联动', 'extLink'], ['市场宽度', 'breadth'], ['市场情绪', 'mood'],
  ];
  console.log('=== 卡片数据量盘点（本地 replica 12:19 午休） ===');
  const empty = [], thin = [];
  for (const [name, k] of CARDS) {
    const v = s[k];
    let n, desc;
    if (v == null) { n = -1; desc = '字段缺失'; }
    else if (Array.isArray(v)) { n = v.length; desc = n === 0 ? '空数组' : n + ' 条'; }
    else if (typeof v === 'object') {
      const inner = v.strong || v.items || v.list;
      if (Array.isArray(inner)) { n = inner.length; desc = '对象·内层数组 ' + n + ' 条' + (Object.keys(v).length ? '（键:' + Object.keys(v).slice(0, 6).join(',') + '）' : ''); }
      else { n = Object.keys(v).length; desc = '对象·' + n + ' 键'; }
    } else { n = -2; desc = String(v).slice(0, 40); }
    const flag = n === 0 || n === -1 ? '❌空' : (n > 0 && n <= 2 ? '⚠️薄' : '✓');
    if (n === 0 || n === -1) empty.push([name, k, desc]);
    else if (n > 0 && n <= 2) thin.push([name, k, desc]);
    console.log(`  ${flag} ${name}（${k}）: ${desc}`);
  }
  console.log('\n空置卡片:', empty.length ? empty.map(e => e[0] + '(' + e[2] + ')').join('、') : '无');
  console.log('内容薄(≤2):', thin.length ? thin.map(e => e[0] + '(' + e[2] + ')').join('、') : '无');
  // 附：关键对象的内部结构（auction 等）
  for (const k of ['auction', 'breadth', 'mood', 'extLink', 'panelNotes']) {
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
      console.log(`\n[${k}] 键:`, Object.keys(s[k]).join(', '));
    }
  }
})();
