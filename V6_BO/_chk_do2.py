# -*- coding: utf-8 -*-
# do 轮：同名异义全量聚合 —— 同一个键名在 /api/state 的不同对象里，是不是同一种东西
import json, urllib.request, urllib.parse, ssl, sys, collections

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
ctx = ssl.create_default_context()
def post(p, b):
    d = json.dumps(b).encode()
    r = urllib.request.Request(BASE + p, data=d, headers={'Content-Type': 'application/json', 'Connection': 'close'})
    return json.loads(urllib.request.urlopen(r, timeout=60, context=ctx).read().decode())
def get(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + p, headers={'Connection': 'close'}), timeout=60, context=ctx).read().decode())

r = post('/api/lock/unlock', {'password': 'Libao1314', 'role': 'edit', 'name': 'FPUB_DO02', 'fp': 'FPUBDO02CHK'})
T = r.get('deviceToken')
st = get('/api/state?token=' + urllib.parse.quote(T))

def tn(v):
    if v is None: return 'null'
    if isinstance(v, bool): return '布尔'
    if isinstance(v, (int, float)): return '数字'
    if isinstance(v, str): return '字符串'
    if isinstance(v, list): return '数组[%d]' % len(v)
    if isinstance(v, dict): return '对象'
    return type(v).__name__

# 递归：键名 -> [(path, 类型, 示例)]
agg = collections.defaultdict(list)
def walk(v, path, depth):
    if depth > 4: return
    if isinstance(v, dict):
        for k, x in v.items():
            p = path + '.' + k
            agg[k].append((p, tn(x), json.dumps(x, ensure_ascii=False)[:40]))
            if isinstance(x, (dict, list)): walk(x, p, depth + 1)
    elif isinstance(v, list):
        for i, x in enumerate(v[:3]):
            p = '%s[%d]' % (path, i)
            if isinstance(x, dict):
                for k, y in x.items():
                    agg[k].append((p + '.' + k, tn(y), json.dumps(y, ensure_ascii=False)[:40]))
                walk(x, p, depth + 1)

walk(st, '', 0)
print('=== 同名异义：同一个键名装了不同类型 ===')
n = 0
for k in sorted(agg.keys()):
    ts = set(t for _, t, _ in agg[k])
    if len(ts) > 1:
        # null 与别的混用只做提示
        solid = set(t for t in ts if t != 'null')
        flag = '❌' if len(solid) > 1 else '·'
        if len(solid) > 1: n += 1
        print('  %s %-14s %s' % (flag, k, ' / '.join(sorted(ts))))
        seen = set()
        for p, t, ex in agg[k]:
            if t in seen: continue
            seen.add(t)
            print('        %-9s %s  = %s' % (t, p[:52], ex[:36]))
print('  真·不同类型处数:', n)

print('\n=== 同名键出现次数最多的（语义是否一致，人工判） ===')
top = sorted(agg.items(), key=lambda kv: -len(kv[1]))[:14]
for k, rows in top:
    ts = set(t for _, t, _ in rows)
    print('  %-12s 出现 %2d 次  类型{%s}', ) if False else print('  %-12s 出现 %2d 次  类型{%s}' % (k, len(rows), ','.join(sorted(ts))))
    if len(ts) == 1:
        paths = [p for p, _, _ in rows][:5]
        print('        ' + ' | '.join(p[:38] for p in paths))

# trendPool 是否被截断（与 trendScanBasis / 趋势池构造对照）
print('\n=== trendPool 是否卡在上限 ===')
print('  trendPool.length =', len(st.get('trendPool') or []))
print('  trendScan.length =', len(st.get('trendScan') or []))
print('  trendRej =', json.dumps(st.get('trendRej'), ensure_ascii=False))
print('  poolSize =', st.get('poolSize'), ' pool.length =', len(st.get('pool') or []))
print('  ztPool.length =', len(st.get('ztPool') or []))
