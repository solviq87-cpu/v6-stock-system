// 锁死「节假日开盘前夜新闻汇总」链路（2026-10-05 用户原话：「加一个节假日开盘前一个晚上所有新闻汇总的功能」）
//   核心难点：mergeArchive 只保留近3日，长假前几天的要闻会被清掉 → 单独开 holidayBuf（不受3日限制，落盘 news.json）。
//   触发：今天休市 + 明天开盘 + 跨度≥3天（排除普通周末，避免与周末汇总重复）+ 缓冲非空。
//   把 server.js 里相关函数原样装进沙箱跑（改了 server.js 这里立刻跟着变，不存在"测试测的是旧代码"）。
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + a + ' / ' + b);
  return SRC.slice(i, j);
};

// within3Days 是自包含的纯函数（只依赖 Date），直接按源码复刻进沙箱，避免连带抽出它和
// mergeArchive 之间的 S.secStocks 等依赖 S 的代码导致 ReferenceError
const within3Days = (t) => { if (!t) return false; const d = String(t).slice(0, 10); const min = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10); return d >= min; };
const mergeSrc = cut('function mergeArchive', 'async function fetchNewsPage');
const newsSrc = cut('function buildNewsDigest', '// __HOLIDAY_HELPERS_END__');

// ⛔ 沙箱注入清单漏一个外部符号 = 整个套件崩掉（不是变红），踩过多次。
//    2026-10-07 起 mergeArchive 改用 NEWS_ARCHIVE_CAP（统一归档上限常量），必须一并注入。
// This suite isolates date/cap behavior; real journal-version validation is in
// tests/news-current-projection.test.js.
const mkMerge = new Function('HOLIDAY_BUF_CAP', 'NEWS_ARCHIVE_CAP', 'within3Days', 'newsEvidenceAllowsItem', `${mergeSrc}\nreturn { mergeArchive };`);
const { mergeArchive } = mkMerge(1200, 300, within3Days, () => true);
const mkNews = new Function('S', 'PAPER_CFG', 'PAPER', 'isTradeDay', 'newsEvidenceAllowsItem', 'newsDecisionAllowsItem', `${newsSrc}\nreturn { buildNewsDigest, holidaySpanUpToToday, holidayDigestShouldFire };`);
const api = mkNews({ news: { badAll: [], goodAll: [], neutralAll: [] } }, {}, {}, () => true, () => true, () => true);

let pass = 0, fail = 0;
const ok = (c, n, g) => { if (c) { pass++; console.log('  ✅ ' + n + (g !== undefined ? '  → ' + g : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + g); } };
const sec = t => console.log('\n' + t);
const dayAgo = n => { const x = new Date(Date.now() - n * 86400000); const p = v => String(v).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} 12:00:00`; };

sec('① mergeArchive：keepAll 跳过近3日过滤 + 去重 + 上限');
{
  ok(mergeArchive([], [{ id: 'x', t: dayAgo(0) }], false).length === 1, '当日新闻（非keepAll）保留');
  ok(mergeArchive([], [{ id: 'x', t: dayAgo(10) }], false).length === 0, '10天前新闻（非keepAll）被近3日过滤掉');
  ok(mergeArchive([], [{ id: 'x', t: dayAgo(10) }], true).length === 1, 'keepAll 时10天前新闻保留（假期缓冲不受3日限制）');
  const dup = mergeArchive([{ id: 'x', t: dayAgo(0) }], [{ id: 'x', t: dayAgo(0) }], true);
  ok(dup.length === 1, '按 id 去重');
  const many = Array.from({ length: 1300 }, (_, i) => ({ id: 'm' + i, t: dayAgo(0) }));
  ok(mergeArchive([], many, true).length === 1200, 'keepAll 上限 = 1200', mergeArchive([], many, true).length);
}

sec('② buildNewsDigest：注入 src 汇总假期全景（按日期过滤 + 多日高频段）');
{
  const mkItem = (type, t, codes, stocks, why, title) => ({ id: 'id-' + Math.random(), type, t, title: title || (type + '示例新闻' + t), summary: '', codes: codes || [], stocks: stocks || [], why: why || 'x', sectors: [] });
  const good = [mkItem('good', '2026-10-01 09:00:00', ['600000'], ['测试(600000)'], '命中利好词'), mkItem('good', '2026-10-01 15:00:00'), mkItem('good', '2026-10-08 10:00:00', ['000001'], ['样例(000001)'], '命中利好词')];
  const bad = [mkItem('bad', '2026-10-01 11:00:00'), mkItem('bad', '2026-10-01 14:00:00')];
  const neutral = [mkItem('neutral', '2026-10-05 10:00:00')];
  const src = { bad, good, neutral, arcLabel: '假期累计归档: 利空2/利好3/中性1' };
  const dates = ['2026-10-08', '2026-10-01'];
  const msg = api.buildNewsDigest(dates, '假期要闻全景 · 开盘前必读', 8, src);
  ok(/假期要闻全景/.test(msg), '标题带「假期要闻全景」', '');
  const line = (msg.match(/归类结果[^\n]*/) || [''])[0];
  ok(/归类结果: 利空 2 条 · 利好 3 条 · 中性 0 条/.test(line), '按日期过滤：中性(10-05)不在日期内→0；利好含10-01+10-08=3', line);
  ok(/假期累计归档: 利空2\/利好3\/中性1/.test(msg), 'arcLabel 用注入的假期归档文案（不走近3日）', '');
  ok(/【🔥 周末高频受益个股】/.test(msg), '多日期(>1)触发高频受益/受累段', '');
  const msg1 = api.buildNewsDigest(['2026-10-08'], '假期要闻全景', 8, src);
  ok(!/高频受益个股/.test(msg1), '单日期不触发高频段', 'ok');
}

sec('③ holidaySpanUpToToday / holidayDigestShouldFire：触发判定（注入 mock isTradeDay）');
{
  // mock 控制：给一个 (diffDays) => isTradeDay 的函数
  const mkFromFn = fn => d => fn(Math.round((Date.now() - d.getTime()) / 86400000));
  // 场景1：今天就是交易日 → 不触发
  let r = api.holidayDigestShouldFire(5, mkFromFn(() => true));
  ok(r.fire === false && r.reason === 'today-trade-day', '今天交易日→不触发', r.reason);
  // 场景2：今天休市、明天也休市 → 不触发
  r = api.holidayDigestShouldFire(5, mkFromFn(diff => diff !== 0 && diff !== -1));
  ok(r.fire === false && r.reason === 'tomorrow-not-open', '明天也不开盘→不触发', r.reason);
  // 场景3：今天+昨天休市、前天开盘、明天开盘（普通周末，跨度2）→ 不触发
  r = api.holidayDigestShouldFire(5, mkFromFn(diff => diff >= 2 || diff < 0));
  ok(r.fire === false && r.span.length === 2 && r.reason === 'span<3-normal-weekend', '普通周末(跨度2)→不触发', r.reason + ' len=' + r.span.length);
  // 场景4：跨度5 但缓冲空 → 不触发
  r = api.holidayDigestShouldFire(0, mkFromFn(diff => diff >= 5 || diff < 0));
  ok(r.fire === false && r.reason === 'empty-buffer', '缓冲空→不触发', r.reason);
  // 场景5：跨度5 缓冲非空 → 触发
  r = api.holidayDigestShouldFire(5, mkFromFn(diff => diff >= 5 || diff < 0));
  ok(r.fire === true && r.span.length === 5, '跨度5+缓冲非空→触发', r.reason + ' len=' + r.span.length);
  // holidaySpanUpToToday 直接验证
  const span = api.holidaySpanUpToToday(mkFromFn(diff => diff >= 5 || diff < 0));
  ok(span.length === 5 && /^20\d\d-\d\d-\d\d$/.test(span[0]), 'holidaySpanUpToToday 返回 YYYY-MM-DD 列表(今天在前)', span.join(','));
}

sec('④ server.js 接线（不接上等于没做）');
{
  ok(!/\r/.test(SRC), 'server.js 无 CRLF（Edit 陷阱）');
  ok(/holidayDigestShouldFire\(\(S\.news\.holidayBuf \|\| \[\]\).length\)/.test(SRC), '假期调度器真正调用 holidayDigestShouldFire（带缓冲长度）');
  ok(/buildNewsDigest\(span, '假期要闻全景 · 开盘前必读'/.test(SRC), '假期调度器用 span 调 buildNewsDigest 全景汇总');
  ok(/S\.news\.holidayBuf = mergeArchive\(S\.news\.holidayBuf/.test(SRC), 'seedNews/refreshNews 把新闻累积进 holidayBuf（keepAll）');
  ok(/S\.news\.holidayBuf = \[\]/.test(SRC), '交易日清空 holidayBuf');
  // ⚠️ 2026-10-05 改口径：旧写法是 `span>=3 就 return`，把长假【中间】的周日（国庆 10/4，
  //    明天 10/5 仍休市）也让给假期全景 —— 而全景只在明天开盘时才发 → 两边都不发，整晚空档。
  //    新口径：只在全景【真的会发】（fire）时才让位，长假中间周日由周末汇总兜底。
  ok(/if \(holidayDigestShouldFire\(\(S\.news\.holidayBuf \|\| \[\]\)\.length\)\.fire\) return;/.test(SRC)
     && !/if \(holidaySpanUpToToday\(\)\.length >= 3\) return;/.test(SRC),
     '周末汇总只在假期全景真的会发时才让位（长假中间周日仍兜底）');
  ok(/!\s*holidayDigestShouldFire\(\(S\.news\.holidayBuf \|\| \[\]\).length\)\.fire/.test(SRC), '每日汇总在长假最后一晚让位给假期汇总（不重复推）');
  ok(/if \(holiday\) \{[\s\S]*holidaySpanUpToToday\(\);[\s\S]*假期要闻全景/.test(SRC), '/api/news-digest 支持 ?holiday 手动补发整个假期缓冲');
  ok(SRC.includes('holidayBuf:') && SRC.includes('S.news.holidayBuf = nj.holidayBuf'), 'holidayBuf 随 news.json 落盘与恢复');
  const v = (SRC.match(/APP_VER = '([^']+)'/) || [])[1];
  ok(/^\d{8}[a-z]{2}$/.test(v || ''), '版本号格式正常', v);
}

sec('⑤ 端到端：真实 2026 放假表 + 可控时钟 → 汇总必须发在「开盘前那一晚」');
{
  // ⓪ 从 server.js 原样抽出放假表与 isTradeDay —— 测试里另抄一份表的话，
  //    项目表改了而测试还按旧样子绿，等于根本没测到点上（2026-10-05 的 bug 就是这么溜过去的）。
  const grabFn = name => {
    const i = SRC.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('未找到函数 ' + name);
    let d = 0;
    for (let j = i; j < SRC.length; j++) {
      const c = SRC[j];
      if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) return SRC.slice(i, j + 1); }
    }
    throw new Error('括号不平衡 ' + name);
  };
  const grabSet = name => {
    const i = SRC.indexOf('const ' + name + ' = new Set([');
    if (i < 0) throw new Error('未找到 ' + name);
    const lb = SRC.indexOf('[', i), rb = SRC.indexOf(']);', i);
    return eval(SRC.slice(lb, rb + 1));
  };
  // isTradeDay 开头会调 holidayTableWarn()（节假日表过期告警），抽取执行时必须注入
  const REAL_TRADE = new Function('MARKET_HOLIDAYS', 'MARKET_WORKDAYS', 'holidayTableWarn',
    grabFn('isTradeDay') + '\nreturn isTradeDay;'
  )(new Set(grabSet('MARKET_HOLIDAYS')), new Set(grabSet('MARKET_WORKDAYS')), () => {});

  // ① 可控时钟：无参 new Date() 与 Date.now() 都固定到指定时刻，这样"今天/明天"才可控
  const clockAt = isoLocal => {
    const fixed = new Date(isoLocal).getTime();
    class FDate extends Date {
      constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
      static now() { return fixed; }
    }
    return FDate;
  };
  // 沙箱多注入一个 Date，让 holidayDigestShouldFire 里的 new Date()/Date.now() 走可控时钟
  const mkClk = new Function('S', 'PAPER_CFG', 'PAPER', 'isTradeDay', 'Date',
    `${newsSrc}\nreturn { holidayDigestShouldFire, holidaySpanUpToToday };`);
  const at = iso => mkClk({ news: {} }, {}, {}, REAL_TRADE, clockAt(iso));

  // ② 国庆：10/1–10/7 休市，10/8 起照常开市（沪深北交易所《2026年部分节假日休市安排》）
  const r7 = at('2026-10-07T21:10:00').holidayDigestShouldFire(1);
  ok(r7.fire === true, '⛔ 10/7 晚（假前最后一晚）必须触发全景汇总', r7.reason);
  ok(r7.span.length === 7 && r7.span[0] === '2026-10-07' && r7.span[6] === '2026-10-01',
    '且覆盖整个假期 10/01–10/07（不是只到 10/07 前几天）', r7.span.join(','));

  const r8 = at('2026-10-08T21:10:00').holidayDigestShouldFire(1);
  ok(r8.fire === false && r8.reason === 'today-trade-day',
    '⛔ 10/8 是交易日 → 绝不再发"开盘前"汇总（曾经的 bug：把 10/8 误写成休市，导致发晚一天）', r8.reason);

  const r5 = at('2026-10-05T21:10:00').holidayDigestShouldFire(1);
  ok(r5.fire === false && r5.reason === 'tomorrow-not-open', '10/5（假期中段，明天仍休市）不发', r5.reason);

  // ③ 日历本身：这次 bug 的根源，单独锁死
  ok(REAL_TRADE(new Date(2026, 9, 7)) === false, '日历：2026-10-07 休市（假期末日）');
  ok(REAL_TRADE(new Date(2026, 9, 8)) === true, '⛔ 日历：2026-10-08 开市（首个交易日）');
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
