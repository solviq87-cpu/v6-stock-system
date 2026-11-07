// 锁死「盘中强势票模块」结构、过滤、评分、概率、API 契约（jz 轮）。
const fs = require('fs');

const srvSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mobSrc = fs.readFileSync(__dirname + '/public/mobile.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

(async () => {
  // ========== ① 后端契约：intradayStrongScan 存在且过滤/评分/返回结构正确 ==========
  sec('① 后端 intradayStrongScan 结构断言');
  {
    const scan = srvSrc.match(/async function intradayStrongScan\(opts = \{\}\) \{[\s\S]*?\n\}/);
    ok(!!scan, 'intradayStrongScan 函数体可提取');
    if (scan) {
      const body = scan[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

      // 过滤条件必须存在
      ok(/pct < 2 \|\| pct >= 8/.test(body), '过滤：涨幅 2%~8%（已启动但未板）');
      ok(/speed < 0/.test(body), '过滤：涨速不为负（拒绝冲高回落）');
      ok(/turnover < 2 \|\| turnover > 15/.test(body), '过滤：换手 2%~15%');
      ok(/amount < 2e8/.test(body), '过滤：成交金额 ≥2 亿');
      ok(/capYi < 35/.test(body), '过滤：流通市值 ≥35 亿');
      ok(/c\.startsWith\('00'\) \|\| c\.startsWith\('60'\) \|\| c\.startsWith\('30'\)/.test(body),
        '过滤：仅主板/中小板/创业板（00/60/30）');

      // 评分维度
      ok(/score \+= pctScore/.test(body), '评分含涨幅分');
      ok(/score \+= speedScore/.test(body), '评分含涨速分');
      ok(/score \+= turnoverScore/.test(body), '评分含换手分');
      ok(/score \+= amountScore/.test(body), '评分含成交金额分');
      ok(/score \+= mainScore/.test(body), '评分含主力资金分');
      ok(/score \+= sectorScore/.test(body), '评分含板块热度分');
      ok(/score \+= gapScore/.test(body), '评分含距涨停距离分');

      // 涨停概率
      ok(/A\.limitUpProbability\(/.test(body), '调用 A.limitUpProbability 计算涨停概率');
      ok(/calibratedProb\(/.test(body), '概率经 calibratedProb 学习校准');

      // 返回结构
      ok(/asOf: now/.test(body), '返回含 asOf');
      ok(/count: top\.length/.test(body), '返回含 count');
      ok(/total: candidates\.length/.test(body), '返回含 total');
      ok(/items: top/.test(body), '返回含 items');
      ok(/note: /.test(body), '返回含 note');
    }
  }

  // ========== ② 后端真跑：抠函数体，桩 S，验证过滤与排序 ==========
  sec('② 后端 intradayStrongScan 真跑（桩数据）');
  {
    const m = srvSrc.match(/async function intradayStrongScan\(opts = \{\}\) \{[\s\S]*?\n\}/);
    ok(!!m, '函数体可提取用于真跑');
    if (m) {
      // 桩：A / sectorOfStock / sectorHeat / numGapRaw / calibratedProb / numNeutral / S.candidatePool
      const A = {
        isJunkName: n => /ST|退|\*/.test(n),
        limitUpProbability: () => 0.55
      };
      const calibratedProb = p => p;
      const numNeutral = (k, v) => (v == null || !isFinite(v) ? 0 : v);
      const sectorOfStock = s => s.sector || '未知';
      const sectorHeat = sec => sec === '热门板块' ? { hot: true, cold: false, ztN: 2, short: '🔥主线·2只涨停' }
        : { hot: false, cold: true, ztN: 0, short: '❄️冷门' };
      const numGapRaw = (code, name, pct) => 10 - pct; // 简化：距涨停 = 10 - 涨幅

      const mkStock = (code, name, pct, speed, turnover, amount, mainPct, mainInflow, floatCap, sector) => ({
        code, name, price: 10, pct, speed, turnover, amount, mainPct, mainInflow,
        floatCap: floatCap * 1e8, sector
      });

      const S = {
        stocks: [
          mkStock('000001', '平安银行', 3.5, 0.8, 5, 5e8, 5, 2e7, 2000, '热门板块'),
          mkStock('600000', '浦发银行', 2.0, 0.1, 3, 3e8, 1, 5e6, 1500, '热门板块'),
          mkStock('300001', '特锐德', 4.2, 1.2, 8, 8e8, 8, 5e7, 300, '热门板块'),
          // 以下应被过滤
          mkStock('000002', '万科A', 1.5, 0.5, 4, 4e8, 2, 1e7, 800, '热门板块'),   // 涨幅不足
          mkStock('600519', '贵州茅台', 8.5, 0.5, 3, 2e9, 3, 1e8, 20000, '热门板块'), // 已板附近
          mkStock('300002', '神州泰岳', 3.0, -0.5, 5, 5e8, 2, 1e7, 200, '热门板块'),  // 涨速负
          mkStock('000004', '国华网安', 3.0, 0.5, 1.5, 5e8, 2, 1e7, 50, '热门板块'),  // 换手低
          mkStock('000005', '世纪星源', 3.0, 0.5, 20, 5e8, 2, 1e7, 50, '热门板块'),  // 换手高
          mkStock('000006', '深振业A', 3.0, 0.5, 5, 1e7, 2, 1e7, 50, '热门板块'),   // 成交不足
          mkStock('000007', '全新好', 3.0, 0.5, 5, 5e8, 2, 1e7, 20, '热门板块'),   // 市值小
          mkStock('688001', '科创板票', 3.0, 0.5, 5, 5e8, 2, 1e7, 200, '热门板块'), // 板块不符
        ],
        candidatePool: [],
        sectors: []
      };

      // 函数体引用模块级缓存变量，必须作为桩注入
      const INTRADAY_STRONG_CACHE_MS = 30 * 1000;
      let _intradayStrongCache = { ts: 0, data: null, busy: false };
      // ⛔ 2026-10-27：ln 轮起评分走 scoreSmoothOf（EMA 磁滞）、ls 轮起选完要过 klineRows 看筹码/量能。
      //    漏注入 → ReferenceError 被函数内 catch 吞掉 → 返回空结果，表现为"一只都没命中"（假红）。
      const scoreSmoothOf = (code, s) => ({ score: s, rawScore: s, trend: 0, trendText: '' });
      const klineRows = async () => [];

      const fn = new Function('S', 'A', 'sectorOfStock', 'sectorHeat', 'numGapRaw', 'calibratedProb', 'numNeutral',
        'INTRADAY_STRONG_CACHE_MS', '_intradayStrongCache', 'scoreSmoothOf', 'klineRows',
        `return (${m[0]});`);
      const run = fn(S, A, sectorOfStock, sectorHeat, numGapRaw, calibratedProb, numNeutral,
        INTRADAY_STRONG_CACHE_MS, _intradayStrongCache, scoreSmoothOf, klineRows);

      const r = await run({ max: 10, force: true });
      ok(r && Array.isArray(r.items), '返回 items 数组', r && typeof r);
      ok(r.count === 3, '只命中 3 只符合条件的票', r.count);
      ok(r.total === 3, '候选总数 3', r.total);
      ok(r.items[0].code === '300001', '评分最高的是特锐德（涨幅/涨速/主力最强）', r.items[0] && r.items[0].code);
      ok(r.items.every(x => x.pct >= 2 && x.pct < 8), '所有结果涨幅在 2%~8%');
      ok(r.items.every(x => x.speed >= 0), '所有结果涨速 ≥0');
      ok(r.items.every(x => x.turnover >= 2 && x.turnover <= 15), '所有结果换手 2%~15%');
      ok(r.items.every(x => x.amount >= 2e8), '所有结果成交 ≥2 亿');
      ok(r.items.every(x => !x.code.startsWith('688')), '没有科创板票');
      ok(r.items.every(x => x.prob != null && x.prob >= 0 && x.prob <= 100), '每条都有 prob 且在 0~100');
      ok(r.items.every(x => Array.isArray(x.reasons) && x.reasons.length > 0), '每条都有 reasons');
      ok(r.note && r.note.includes('扫描'), 'note 含扫描说明', r.note);

      // 缓存命中
      const r2 = await run({ max: 10 });
      ok(r2 === r, '30 秒内非 force 返回缓存');
    }
  }

  // ========== ③ API 路由契约 ==========
  sec('③ API 路由 /api/intraday-strong 契约');
  {
    ok(/p === '\/api\/intraday-strong'/.test(srvSrc), '/api/intraday-strong 路由存在');
    // lp/lo 轮：路由多了 board 切换与 sentinel 动态（手写 json 里附带），断言改钉语义：
    // 路由必须把 force/max/board 原样交给 intradayStrongScan，并把它的结果直接 json 出去。
    const _ri = srvSrc.indexOf("if (p === '/api/intraday-strong')");
    const _rt = _ri < 0 ? '' : srvSrc.slice(_ri, _ri + 900);
    ok(/await intradayStrongScan\(\{ force, max, board \}\)/.test(_rt) && /json\(res, d\)/.test(_rt),
      '路由直通 intradayStrongScan 结果（含 board 视图与 sentinel 附带）');
    ok(/p === '\/api\/intraday-strong'\);?\s*\{\s*const force = isEditorReq\(req\) && \(\(u\.searchParams\.get\('force'\) === '1'\) \|\| \(req\.method === 'POST'\)\)/.test(srvSrc),
      'force=1/POST 重算收回给开发者（只读看缓存）');
  }

  // ========== ④ 前端契约：mobile.html 有卡片/渲染/加载函数 ==========
  sec('④ 前端 mobile.html 盘中强势模块断言');
  {
    ok(/id="isCard"/.test(mobSrc), '存在 isCard 卡片容器');
    ok(/id="isBody"/.test(mobSrc), '存在 isBody 内容容器');
    ok(/id="isMeta"/.test(mobSrc), '存在 isMeta 元信息容器');
    ok(/function renderIntradayStrong\(d\)/.test(mobSrc), '存在 renderIntradayStrong 函数');
    ok(/function loadIntradayStrong\(force\)/.test(mobSrc), '存在 loadIntradayStrong 函数');
    ok(/function toggleIs\(\)/.test(mobSrc), '存在 toggleIs 折叠函数');
    ok(/loadIntradayStrong\(false\)/.test(mobSrc), 'render() 中调用 loadIntradayStrong');
    ok(/\/api\/intraday-strong/.test(mobSrc), '前端请求 /api/intraday-strong');
    ok(/涨停概率/.test(mobSrc), '前端展示涨停概率');
  }

  // 汇总
  console.log('\n──── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────');
  process.exit(fail ? 1 : 0);
})();
