# -*- coding: utf-8 -*-
# G2 一次性测量：.kline_cache 全库缺柱率（窗口内连续性），口径与 server.js isTradeDay 同一把尺子
#   「应有交易日」= 该票缓存首柱日~末柱日之间的交易日数（窗口自洽，不假设上市日）；
#   缺柱率 = 1 - 实际有柱交易日数 / 应有交易日数。另测：重复日期、空文件、僵尸末柱、
#   缺口日期全库累计、fallback/src 分层。⛔ 未测出 ≠ 没问题，全部如实报。
import json, os, collections, datetime, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, '.kline_cache')

# ── 交易日历（抄 server.js:2998-3049，MARKET_WORKDAYS 2026 为空集）──
MARKET_HOLIDAYS = set('''2026-01-01
2026-02-15 2026-02-16 2026-02-17 2026-02-18 2026-02-19 2026-02-20 2026-02-21 2026-02-22
2026-04-04 2026-04-05 2026-04-06
2026-05-01 2026-05-02 2026-05-03 2026-05-04 2026-05-05
2026-06-19 2026-06-20 2026-06-21
2026-10-01 2026-10-02 2026-10-03 2026-10-04 2026-10-05 2026-10-06 2026-10-07'''.split())
MARKET_WORKDAYS = set()

def is_trade_day(d):
    ds = d.strftime('%Y-%m-%d')
    if ds in MARKET_WORKDAYS: return True
    if ds in MARKET_HOLIDAYS: return False
    return d.weekday() < 5

def parse_date(s):
    s = str(s or '')
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y%m%d'):
        try: return datetime.datetime.strptime(s[:10] if fmt == '%Y-%m-%d' else s, fmt).date()
        except Exception: pass
    return None

def trade_days_between(a, b):
    out, cur = [], a
    while cur <= b:
        if is_trade_day(cur): out.append(cur)
        cur += datetime.timedelta(days=1)
    return out

def row_date(r):
    if isinstance(r, dict):
        return parse_date(r.get('date') or r.get('day') or r.get('t'))
    if isinstance(r, list) and r:
        return parse_date(r[0])
    return None

REF_LAST = datetime.date(2026, 10, 16)   # 最近已收盘交易日（今天 10-17 周六）

files = [f for f in os.listdir(CACHE) if f.endswith('.json')]
n_files = len(files)
empty, zombie, gap_buckets = [], [], collections.Counter()
dup_date_files = []
gap_by_fallback = collections.defaultdict(lambda: [0, 0])   # fb -> [缺口柱总数, 应有柱总数]
gap_by_src = collections.defaultdict(lambda: [0, 0])
gap_date_counter = collections.Counter()
worst = []          # (缺柱率, code, first, last, 应有, 实有)
gap_pct_list = []
errs = []

for f in files:
    code = f[:-5]
    try:
        d = json.load(open(os.path.join(CACHE, f), encoding='utf-8'))
    except Exception as e:
        errs.append((f, str(e)[:60])); continue
    rows = d.get('rows') if isinstance(d, dict) else (d if isinstance(d, list) else [])
    rows = [r for r in (rows or []) if row_date(r)]
    fb = str((d or {}).get('fallback')) if isinstance(d, dict) else '?'
    src = str((d or {}).get('src')) if isinstance(d, dict) else '?'
    if not rows:
        empty.append(code); continue
    dates = [row_date(r) for r in rows]
    dset = set(dates)
    if len(dset) != len(dates): dup_date_files.append((code, len(dates) - len(dset)))
    first, last = min(dset), max(dset)
    if last < REF_LAST - datetime.timedelta(days=3):
        zombie.append((code, str(last))); continue   # 僵尸文件单独看，不进缺柱统计
    should = trade_days_between(first, last)
    miss = [x for x in should if x not in dset]
    n_should, n_miss = len(should), len(miss)
    gp = n_miss / n_should if n_should else 0.0
    gap_pct_list.append(gp)
    b = '0（无缺柱）' if n_miss == 0 else ('<2%' if gp < 0.02 else ('2-5%' if gp < 0.05 else ('5-10%' if gp < 0.10 else '>10%')))
    gap_buckets[b] += 1
    gap_by_fallback[fb][0] += n_miss; gap_by_fallback[fb][1] += n_should
    gap_by_src[src][0] += n_miss; gap_by_src[src][1] += n_should
    for x in miss: gap_date_counter[str(x)] += 1
    worst.append((gp, code, str(first), str(last), n_should, len(dset), n_miss))

worst.sort(reverse=True)
n_stat = len(gap_pct_list)
avg = sum(gap_pct_list) / n_stat if n_stat else 0
print('=== G2 K线缓存缺柱率测量（%s）===' % datetime.date.today())
print('文件总数 %d | 解析失败 %d | 空缓存 %d | 僵尸末柱(停更>3天) %d | 进缺柱统计 %d'
      % (n_files, len(errs), len(empty), len(zombie), n_stat))
print('\n[缺柱率分布]', dict(gap_buckets))
print('平均缺柱率 %.3f%% | 缺柱率中位 %.3f%% | 有缺柱的票 %d (%.1f%%)'
      % (avg * 100, sorted(gap_pct_list)[n_stat // 2] * 100 if n_stat else 0,
         sum(1 for g in gap_pct_list if g > 0), (sum(1 for g in gap_pct_list if g > 0) / n_stat * 100) if n_stat else 0))
print('\n[fallback 分层]', {k: '%d/%d=%.2f%%' % (v[0], v[1], v[0] / v[1] * 100 if v[1] else 0) for k, v in gap_by_fallback.items()})
print('[src 分层]     ', {k: '%d/%d=%.2f%%' % (v[0], v[1], v[0] / v[1] * 100 if v[1] else 0) for k, v in gap_by_src.items()})
print('\n[缺口日期全库累计 Top15]')
for ds, c in gap_date_counter.most_common(15):
    print('  %s  缺 %d 只' % (ds, c))
print('\n[缺柱最严重 Top15]（code 首柱 末柱 应有/实有 缺柱率）')
for gp, code, f0, f1, ns, nh, nm in worst[:15]:
    print('  %s  %s~%s  %d/%d  %.1f%%' % (code, f0, f1, nh, ns, gp * 100))
if dup_date_files:
    print('\n[重复日期文件 Top10]', dup_date_files[:10])
if zombie:
    print('\n[僵尸末柱 Top15]', zombie[:15])
if errs:
    print('\n[解析失败]', errs[:5])
if empty:
    print('\n[空缓存文件 Top15]', empty[:15])
