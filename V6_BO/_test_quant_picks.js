// 锁死「量化选股结果带所属板块」（2026-10-19 iy 轮）。
// 背景：用户「量化选股选出的股票后面加上所属板块」。ir 轮建量化选股时 secName 就算错了 ——
//   sectorOfStock(stock) 要的是对象（内部读 stock.code），原写法传字符串 code →
//   stock.code=undefined → 四层归属全不命中恒返 '未知'；且它返回字符串，原写法却取 .name
//   → 恒 undefined；叠加新浪全A快照没有 sector 字段（s.sector 恒 undefined）→ secName 恒 ''
//   → 条件5（板块热前5）从未生效、sector 下发也恒空。en 轮口径普查在 analyzePreBuy 修过
//   同款双重 bug，ir 轮新代码复现 —— ⛔ 教训：sectorOfStock 只许传 {code,name} 对象、
//   返回值是字符串不许取 .name。
// 铁律：⛔ 四层查不到（'未知'）映射为 ''，空串=没有板块数据，不拿 0 / 假板块名冒充；
//   前端只在 sector 非空时渲染「所属板块」行（缺数据≠造假板块），且 sector 文本必经 esc()。
const fs = require('fs');

const srvSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mobSrc = fs.readFileSync(__dirname + '/public/mobile.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// ========== ① 后端契约：quantPicksScan 输出对象含 sector，值取 secName ==========
sec('① 后端 quantPicksScan 输出含 sector 字段（结构断言，钉生产源码）');
{
  const scan = srvSrc.match(/async function quantPicksScan\(opts = \{\}\) \{[\s\S]*?\n\}/);
  ok(!!scan, 'quantPicksScan 函数体可提取');
  if (scan) {
    // ⛔ §7：判代码用剥注释版——注释里引用旧 bug 写法（sectorOfStock(code)/sector.name）会被反证正则误伤
    const body = scan[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 调用惯例：sectorOfStock 只许传对象（函数内部读 stock.code；传字符串→四层全不命中）
    ok(/const sector = sectorOfStock\(\{ code, name: s\.name \}\);/.test(body),
      'sectorOfStock 传 {code,name} 对象（对齐 L2112/4440/9271 调用惯例）');
    // '未知' 是四层查不到的哨兵，映射空串（缺数据≠造假板块）
    ok(/const secName = \(sector && sector !== '未知'\) \? sector : '';/.test(body),
      "'未知' 映射为 ''（查不到不显示假板块）");
    // 反证：en 轮同款双重 bug 写法不许回来
    ok(!/sectorOfStock\(code\)/.test(body), '反证：不存在 sectorOfStock(code) 字符串调用');
    ok(!/sector\.name/.test(body), '反证：不存在对 sectorOfStock 字符串返回值取 .name');
    // 输出对象（lo 轮：out.push 前有 score 磁滞两行，匹配从 out.push 起到 hitIds 行）
    const push = body.match(/out\.push\(\{[\s\S]*?hitIds:[^\n]*\n\s*\}\);/);
    ok(!!push, 'out.push 输出对象可提取');
    if (push) {
      ok(/\bsector\s*:/.test(push[0]), '输出对象含 sector 字段',
        (push[0].match(/\bsector\s*:[^\n,]*/) || ['(无)'])[0].trim());
      ok(/sector\s*:\s*secName/.test(push[0]), 'sector 值取 secName（四层归属算好的那个，不二次猜）');
      // 反证：sector 不许写成写死值 / 0 冒充
      ok(!/sector\s*:\s*(0|'未知'|'--'|null)\s*,/.test(push[0]), 'sector 不许写死 0/未知/--/null 冒充');
    }
  }
  // 路由直通：/api/quant-picks 原样返回 quantPicksScan 结果，sector 不被中间层剥掉
  ok(/p === '\/api\/quant-picks'/.test(srvSrc), '/api/quant-picks 路由存在');
  ok(/quantPicksScan\(\{ force, max, board \}\)/.test(srvSrc), 'lo：路由把 board 透传给 quantPicksScan（板块切换同竞价共振卡）');
  // ⛔ 2026-10-28 改钉语义（原断言钉死精确串 `d.sentinel=(S.ztSentLog||[]).slice(0,12)`，
  //    d3ac377「哨兵动态仅主板」在中间插了 .filter(isMainBoardCode) 后必然假红）。
  //    现在钉三件事：①仍从 S.ztSentLog 取；②仍截前 12 条；③必须带主板过滤（把过滤删了会红，不是白送通过）。
  {
    const _flat = srvSrc.replace(/\s/g, '');
    ok(/d\.sentinel=\(S\.ztSentLog\|\|\[\]\)/.test(_flat) && /\.slice\(0,12\)/.test(_flat) && /isMainBoardCode/.test(_flat),
      'lo：路由下发哨兵动态（S.ztSentLog 前 12 条，且只留主板）');
  }
  // ju 轮（2026-10-22）：js 轮把本接口放开给只读身份后，「看结果」与「触发重算」必须分级——
  //   force=1/POST 绕过 TTL 缓存重跑全市场扫描（busy 只挡并发、挡不住连环重算），
  //   只读设备反复 force 能把线上实例按在持续扫描上。钉死 force 计算带 isEditorReq。
  ok(/p === '\/api\/quant-picks'\);?\s*\{\s*const force = isEditorReq\(req\) && \(\(u\.searchParams\.get\('force'\) === '1'\) \|\| \(req\.method === 'POST'\)\)/.test(srvSrc),
    'ju 轮：force=1/POST 重算收回给开发者（只读照常看缓存结果）');
}

// ========== ② 后端 sectorOfStock 调用惯例真跑（抠函数体，桩四层数据源） ==========
sec('② sectorOfStock 真跑：传字符串恒「未知」（旧 bug 实证），传对象才命中');
{
  const m = srvSrc.match(/function sectorOfStock\(stock\) \{[\s\S]*?\n\}/);
  ok(!!m, 'sectorOfStock 函数体可提取');
  if (m) {
    // 依赖注入：S / pickTopSector / boardsOf / sectorRankMap / GEO_BOARD_RE
    const mkS = (zt, secs) => ({ ztPool: zt || [], sectors: secs || [], secStocks: new Map(), stockBoards: new Map() });
    const stubs = {
      pickTopSector: a => (a && a.length ? a[0] : null),
      boardsOf: () => null,
      sectorRankMap: () => new Map(),
      GEO_BOARD_RE: /(?!)/   // 永不匹配，放行任意板块名
    };
    const fn = new Function('S', 'pickTopSector', 'boardsOf', 'sectorRankMap', 'GEO_BOARD_RE', `return (${m[0]});`);
    const run = (stock, S, boards) => fn(S, stubs.pickTopSector, boards || stubs.boardsOf, stubs.sectorRankMap, stubs.GEO_BOARD_RE)(stock);

    // 旧 bug 实证：传字符串 → stock.code=undefined → 四层全不命中
    const S1 = mkS([{ code: '600967', sector: '国防军工' }], []);
    ok(run('600967', S1) === '未知', '传字符串 code → 恒「未知」（ir 轮旧 bug：四层全不命中）');
    // 修法实证：传对象 → 第一层涨停池行业命中
    ok(run({ code: '600967', name: '内蒙一机' }, S1) === '国防军工', '传对象 → 涨停池行业层命中');
    // 第二层：板块龙头（ztPool 无该票时）
    const S2 = mkS([], [{ leaderCode: '600967', name: '机器人' }]);
    ok(run({ code: '600967', name: '内蒙一机' }, S2) === '机器人', '传对象 → 板块龙头层命中');
    // 第四层：个股题材（boardsOf 缓存）
    ok(run({ code: '603337', name: '杰克科技' }, mkS(), () => [{ name: '半导体', pct: 5 }]) === '半导体',
      '传对象 → 个股题材层命中（boardsOf 缓存）');
    // 四层全落空 → '未知'（量化选股侧再映射为 ''）
    ok(run({ code: '999999', name: '查无此票' }, mkS()) === '未知', '四层全落空 → 「未知」（由调用方映射空串）');
  }
}

// ========== ③ 前端真跑：抠 mobile.html 的 esc + renderQuantPicks，桩 DOM 实跑 ==========
sec('③ 前端 renderQuantPicks 沙箱真跑（new Function 抠 mobile.html 函数体）');
{
  const mEsc = mobSrc.match(/function esc\(s\)\{[^\n]*\}/);
  const mRqp = mobSrc.match(/function renderQuantPicks\(d\)\{[\s\S]*?\n\}/);
  ok(!!mEsc && !!mRqp, 'esc 与 renderQuantPicks 函数体可提取');
  if (mEsc && mRqp) {
    const escFn = new Function(`return (${mEsc[0]});`)();
    const renderFactory = new Function('document', 'esc', `return (${mRqp[0]});`);
    // 桩 DOM：记录 innerHTML 赋值
    const mkDoc = () => {
      const store = {};
      return { getElementById(id) { if (!store[id]) store[id] = { innerHTML: '', style: {} }; return store[id]; } };
    };
    const run = d => { const doc = mkDoc(); const rqp = renderFactory(doc, escFn); rqp(d); return doc; };

    // ②-1 有 sector → 渲染「所属板块」行且带板块名，位置在股票行之后、理由行之前
    {
      const doc = run({
        asOf: Date.now(), items: [
          { code: '603337', name: '杰克科技', pct: 10.0, sector: '专用设备', hit: [{ id: 5, text: '条件5：…' }] }
        ]
      });
      const html = doc.getElementById('qpBody').innerHTML;
      ok(html.includes('所属板块：专用设备'), '有 sector → 渲染「所属板块：专用设备」');
      const iHead = html.indexOf('qp-head'), iSec = html.indexOf('qp-sector'), iReason = html.indexOf('qp-reason');
      ok(iHead >= 0 && iSec > iHead && iReason > iSec, '板块行排在股票行之后、命中理由之前（「股票后面加上板块」）');
      ok(html.includes('杰克科技') && html.includes('+10.0%'), '原有字段（名称/涨跌幅）渲染不回归');
    }
    // ②-2 空 sector（'' / null / undefined）→ 不渲染板块行（缺数据≠造假板块）
    {
      const doc = run({
        asOf: Date.now(), items: [
          { code: '000001', name: '空串票', pct: 1.0, sector: '', hit: [{ id: 1, text: '条件1：…' }] },
          { code: '000002', name: 'Null票', pct: 2.0, sector: null, hit: [{ id: 1, text: '条件1：…' }] },
          { code: '000003', name: '缺失票', pct: 3.0, hit: [{ id: 1, text: '条件1：…' }] }
        ]
      });
      const html = doc.getElementById('qpBody').innerHTML;
      ok(!html.includes('所属板块'), '空串/null/缺失 sector → 不渲染板块行');
      ok(!/所属板块：\s*(undefined|null|''|")/.test(html) && !html.includes('undefined'), '页面不漏 undefined/null 字样');
      ok((html.match(/qp-item/g) || []).length === 3, '三条 item 照常渲染');
    }
    // ②-3 sector 文本必经 esc（XSS 尺子与全页一致）
    {
      const doc = run({
        asOf: Date.now(), items: [
          { code: 'XSS1', name: '注入票', pct: 5.0, sector: '<img src=x onerror=alert(1)>', hit: [{ id: 1, text: '条件1：…' }] }
        ]
      });
      const html = doc.getElementById('qpBody').innerHTML;
      ok(html.includes('&lt;img') && !html.includes('<img src=x'), 'sector 经 esc 转义（裸 <img> 不漏到页面）');
    }
    // ②-4 locked 分支不回归
    {
      const doc = run({ locked: true });
      ok(doc.getElementById('qpCard').style.display === 'none', 'locked → 卡片隐藏（不回归）');
    }
    // ②-5 CSS 类存在（.qp-sector 有样式，不是裸文本）
    ok(/\.qp-sector\{[^}]*\}/.test(mobSrc), 'mobile.html 定义 .qp-sector 样式');
  }
}

console.log(`\n结果：${pass} 过 / ${fail} 败`);
process.exit(fail ? 1 : 0);
