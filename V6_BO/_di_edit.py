# di 轮改码：「够了/达标」的尺子收口为 NEED_RULE 登记表 + 评分带 basis 如实说明
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    n = s.count('\r')
    s2 = fn(s)
    if s2 is None:
        print('失败(未替换):', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR 前', n, '后', io.open(p, encoding='utf-8').read().count('\r'))

def rep(s, old, new, cnt=1):
    if s.count(old) != cnt:
        print('  !! 锚点命中 %d 次（应 %d）: %r' % (s.count(old), cnt, old[:70])); sys.exit(1)
    return s.replace(old, new, cnt)

# ───────── 1. server.js：插入 NEED_RULE 登记表 ─────────
NEED = u'''// ─── 「够了 / 达标」的尺子登记表（2026-10-07 di 轮）─────────────────────
// 全项目到处都在判「够不够」：K 线几根才够、样本几天才够、评分多少才算达标。
// 实测这些门槛散在 11 种写法里：5 / 6 / 8 / 12 / 21 / 25 / 30 / 40 / 45 / 60 / 100 根 ——
// 同一份 K 线在精选池「够」、在涨停前扫描「不足 40 根直接跳过」：同一只票在这头有分、
// 在那头连门都没进。更隐蔽的是评分本身：入池门槛只要 5 根，而 scoreStock 的分项
// （获利盘要 5 根、90 日涨停基因要 90 根）在短数据下天然残缺 —— 于是同一个 62 分，
// A 票是「8 个分项全算过」的 62，B 票是「只算过 4 个分项」的 62，两者同池排序、
// 同比那条「评分线 75」。量的是两把不同的尺子，而且从头到尾没人说。
// 现在门槛全部登记进表（每个门槛写清它保护什么），「不够时怎么办」也必须登记：
//   skip    = 跳过不进（对外不出现）
//   null    = 返回 null，调用方按「没判」处理
//   partial = 照算，但窗口不足 → 得分系统性偏低，必须明写出来
//   zero    = ⛔ 给 0（0 是一个真实的低分，会参与排序与达标判定）—— 只许用于「确实很差」
const NEED_RULE = {
  pool:     { n: 5,   onLess: 'skip',    note: '精选池入池：K 线不足 5 根不进池' },
  profit:   { n: 5,   onLess: 'null',    note: '获利盘 calcProfitRatio：不足 5 根返回 null（评分里按「未计入」处理，不许当 0）' },
  learn:    { n: 6,   onLess: 'skip',    note: 'learnall 入库 / 预测：6 根' },
  hengpan:  { n: 12,  onLess: 'null',    note: '横盘放量：12 根（前 10 日振幅 + 今日量能）' },
  hygiene:  { n: 21,  onLess: 'skip',    note: '趋势卫生体检：21 根（20 日视野）' },
  trendChk: { n: 25,  onLess: 'null',    note: '趋势基础检查 / 八字闸门：25 根' },
  ztpre:    { n: 40,  onLess: 'skip',    note: '涨停前形态扫描与入库：40 根' },
  backtest: { n: 45,  onLess: 'skip',    note: '回测与学习样本：45 根（⛔ 比入池的 5 根严 9 倍 —— 评分线正是用这批样本学出来的）' },
  weekly:   { n: 60,  onLess: 'null',    note: '周线金叉：60 根（至少 10 周才算得出 MA10 及前值）' },
  zt90:     { n: 90,  onLess: 'partial', note: '90 日涨停基因：不足 90 根时窗口按实际根数，该项得分系统性偏低' }
};
const needOf = k => { const d = NEED_RULE[k]; return d ? d.n : 0; };
const needLess = k => { const d = NEED_RULE[k]; return d ? d.onLess : ''; };
// 评分的「够不够」：把这份分是在多少根 K 线上、按多少满分算出来的，如实说给用户。
// ⛔ 不许只报一个裸分 —— 62 分既可能是「全项算过的 62」，也可能是「只算过 4 项的 62」，
//    而后者会被同一条「评分线 75」判死，且面板上看不出它是因为数据少才低的。
function scoreNoteOf(score, basis) {
  const b = basis;
  if (!b) return '';
  if (!b.rows) return '未评分（无K线，不是 0 分）';
  const miss = b.missing || [], par = b.partial || [];
  if (!miss.length && !par.length) return '';
  const seg = [];
  if (miss.length) seg.push('未计入：' + miss.join('、'));
  if (par.length) seg.push('窗口不足：' + par.join('、'));
  return `评分 ${score}（K线仅${b.rows}根，满分按${b.avail}计；${seg.join('；')}）`;
}
function needRuleState() {
  const o = {};
  for (const k of Object.keys(NEED_RULE)) { const d = NEED_RULE[k]; o[k] = { n: d.n, onLess: d.onLess, note: d.note }; }
  return o;
}
let _rollbackMsg = null;'''

def f1(s):
    return rep(s, u'let _rollbackMsg = null;', NEED)

rw('server.js', f1)

# ───────── 2. server.js：精选池解构 basis + 存进 item ─────────
def f2(s):
    s = rep(s, u"    const { score, detail } = A.scoreStock({\n      rows: k.rows, profitRatio, turnoverRank2d: i + 1, total,\n      mainPct: s.mainPct, pct: s.pct, zt90\n    });",
               u"    const { score, detail, basis: _scoreBasis } = A.scoreStock({\n      rows: k.rows, profitRatio, turnoverRank2d: i + 1, total,\n      mainPct: s.mainPct, pct: s.pct, zt90\n    });")
    s = rep(s, u"      zt90, score, detail, paths, pathWhy, focused\n    });",
               u"      zt90, score, detail, paths, pathWhy, focused,\n      basis: _scoreBasis, scoreNote: scoreNoteOf(score, _scoreBasis)\n    });")
    return s

rw('server.js', f2)

# ───────── 3. server.js：/api/state 下发 needRule ─────────
def f3(s):
    return rep(s, u"      cfgRange: cfgRangeState(),",
                   u"      cfgRange: cfgRangeState(),\n      needRule: needRuleState(),")

rw('server.js', f3)

# ───────── 4. analysis.js：scoreStock 返回 basis ─────────
OLD_HEAD = u"""  const { profitRatio, turnoverRank2d, total, mainPct, pct, zt90 } = o || {};
  const rows = (o && o.rows) || [];
  // 没有 K 线就谈不上评分：直接给 0 分，不要走到下面某处 `rows[i].turnover` 再崩。
  if (!rows.length) return { score: 0, detail: {} };
  let s = 0; const detail = {};"""
NEW_HEAD = u"""  const { profitRatio, turnoverRank2d, total, mainPct, pct, zt90 } = o || {};
  const rows = (o && o.rows) || [];
  // 没有 K 线就谈不上评分。⛔ 这里原来是 `return { score: 0 }` —— 0 是一个**真实的低分**，
  //   会参与排序、会去比那条「评分线 75」，等于用「判了，很差」冒充「没判」。
  //   （同一条原则在八字四维那儿早已落实：baziDim 明写「不许用 50 冒充判出来的分」）
  //   现在按 MISS_RULE 的 clear 类处理：给 null 并把 basis 说清楚。
  if (!rows.length) return { score: null, detail: {}, basis: { rows: 0, avail: 0, missing: ['全部（无K线）'], partial: [], zt90Win: 0 } };
  // 「这份分到底算全了没有」：avail = 本次真正计入的满分；missing = 数据不足根本没算的项；
  // partial = 算了但窗口不足（得分系统性偏低）。三者一起随分返回，调用方必须能说出来。
  let s = 0; const detail = {};
  let avail = 0; const missing = [], partial = [];"""

def f4(s):
    s = rep(s, OLD_HEAD, NEW_HEAD)
    # 1. 近3日上涨
    s = rep(s, u"""  const last3 = rows.slice(-3);
  const upDays = last3.filter(r => r.pct > 0).length;
  detail['3日上涨'] = `${upDays}/3`;
  s += upDays >= 3 ? 12 : upDays === 2 ? 7 : 0;""",
               u"""  const last3 = rows.slice(-3);
  const upDays = last3.filter(r => r.pct > 0).length;
  detail['3日上涨'] = `${upDays}/3`;
  s += upDays >= 3 ? 12 : upDays === 2 ? 7 : 0;
  avail += 12;
  if (rows.length < 3) partial.push(`近3日上涨（仅${rows.length}日，满窗需3日）`);""")
    # 2. 涨幅温和
    s = rep(s, u"""  if (maxPct3 <= 7) s += 8;
  else if (maxPct3 <= 9.9) s += 4;
  detail['3日最大涨幅'] = `${maxPct3.toFixed(1)}%`;""",
               u"""  if (maxPct3 <= 7) s += 8;
  else if (maxPct3 <= 9.9) s += 4;
  avail += 8;
  detail['3日最大涨幅'] = `${maxPct3.toFixed(1)}%`;""")
    # 3. 获利筹码
    s = rep(s, u"""  const pr = profitRatio == null ? 0 : profitRatio * 100;
  detail['获利筹码'] = `${pr.toFixed(0)}%`;
  s += pr >= 85 ? 15 : pr >= 70 ? 11 : pr >= 50 ? 6 : 0;""",
               u"""  const pr = profitRatio == null ? 0 : profitRatio * 100;
  detail['获利筹码'] = `${pr.toFixed(0)}%`;
  // ⛔ 获利盘算不出来（K线不足 5 根）时这一项**不计入 avail**，而不是按 0 计分：
  //    按 0 计 = 悄悄扣掉 15 分还装作判过了。
  if (profitRatio == null) missing.push('获利筹码');
  else { avail += 15; s += pr >= 85 ? 15 : pr >= 70 ? 11 : pr >= 50 ? 6 : 0; }""")
    # 4. 换手排名
    s = rep(s, u"""  detail['换手排名'] = `${rk}/${total}`;
  s += rk <= 100 ? 15 : rk <= 300 ? 9 : rk <= 600 ? 5 : 0;""",
               u"""  detail['换手排名'] = `${rk}/${total}`;
  s += rk <= 100 ? 15 : rk <= 300 ? 9 : rk <= 600 ? 5 : 0;
  avail += 15;""")
    # 5. 90日涨停
    s = rep(s, u"""  detail['90日涨停'] = `${zt90}次`;
  s += zt90 >= 3 ? 15 : zt90 === 2 ? 10 : zt90 === 1 ? 5 : 0;""",
               u"""  detail['90日涨停'] = `${zt90}次`;
  s += zt90 >= 3 ? 15 : zt90 === 2 ? 10 : zt90 === 1 ? 5 : 0;
  avail += 15;
  // 窗口不足 90 根时，这一项算的是「N 日内涨停几次」而不是「90 日内」—— 天然偏低
  if (rows.length < 90) partial.push(`90日涨停基因（仅${rows.length}日窗口，满窗需90日）`);""")
    # 6. 主力资金
    s = rep(s, u"""  s += mp > 0 ? 6 : 0; s += mp >= 10 ? 8 : mp >= 5 ? 5 : 0;""",
               u"""  s += mp > 0 ? 6 : 0; s += mp >= 10 ? 8 : mp >= 5 ? 5 : 0;
  avail += 14;""")
    # 7. 当日涨幅
    s = rep(s, u"""  if (pct >= 2 && pct <= 7) s += 10; else if (pct > 0 && pct < 2) s += 5;""",
               u"""  if (pct >= 2 && pct <= 7) s += 10; else if (pct > 0 && pct < 2) s += 5;
  avail += 10;""")
    # 8. 换手温和 + 返回
    s = rep(s, u"""  if (t1 >= 3 && t1 <= 20) s += 5;
  detail['今日换手'] = `${t1.toFixed(1)}%`;
  return { score: Math.min(Math.round(s), 100), detail };""",
               u"""  if (t1 >= 3 && t1 <= 20) s += 5;
  avail += 5;
  detail['今日换手'] = `${t1.toFixed(1)}%`;
  return {
    score: Math.min(Math.round(s), 100), detail,
    basis: { rows: rows.length, avail, missing, partial, zt90Win: Math.min(90, rows.length) }
  };""")
    return s

rw('analysis.js', f4)
print('全部完成')
