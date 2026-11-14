# -*- coding: utf-8 -*-
# do 轮线上实测：/api/state 每个字段的「真实类型」，对照前端用法找同名异义
import json, urllib.request, urllib.parse, ssl, sys, re, io

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
ctx = ssl.create_default_context()
def post(p, b):
    d = json.dumps(b).encode()
    r = urllib.request.Request(BASE + p, data=d, headers={'Content-Type': 'application/json', 'Connection': 'close'})
    return json.loads(urllib.request.urlopen(r, timeout=60, context=ctx).read().decode())
def get(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + p, headers={'Connection': 'close'}), timeout=60, context=ctx).read().decode())

r = post('/api/lock/unlock', {'password': 'REDACTED_HISTORICAL_LOCK_PASSWORD', 'role': 'edit', 'name': 'FPUB_DO01', 'fp': 'FPUBDO01CHK'})
T = r.get('deviceToken')
if not T:
    print('FAIL 未拿到 token', r); sys.exit(1)
st = get('/api/state?token=' + urllib.parse.quote(T))

def tn(v):
    if v is None: return 'null'
    if isinstance(v, bool): return '布尔'
    if isinstance(v, (int, float)): return '数字'
    if isinstance(v, str): return '字符串'
    if isinstance(v, list): return '数组[%d]' % len(v)
    if isinstance(v, dict): return '对象{%s}' % ','.join(list(v.keys())[:4])
    return type(v).__name__

print('=== /api/state 顶层字段 %d 个 ===' % len(st))
rows = []
for k in sorted(st.keys()):
    v = st[k]
    rows.append((k, tn(v), v))
for k, t, v in rows:
    print('  %-22s %-24s %s' % (k, t, (json.dumps(v, ensure_ascii=False)[:70] if not isinstance(v, (list, dict)) else '')))

# 前端用法对照
HV = io.open('public/index.html', encoding='utf-8').read()
use = {}
for m in re.finditer(r'\bs\.([A-Za-z_$][\w$]*)', HV):
    k = m.group(1)
    after = HV[m.start():m.start() + 40]
    u = None
    if re.match(r's\.[\w$]+\s*\|\|\s*\[\]', after) or re.match(r's\.[\w$]+\.length', after): u = '当数组'
    elif re.match(r's\.[\w$]+\.(items|count|cand|plan|list)\b', after): u = '当对象'
    elif re.match(r's\.[\w$]+\.time\b', after): u = '读 .time'
    if u: use.setdefault(k, set()).add(u)

print('\n=== 前端当作数组 / 对象消费，但线上实际类型不是的 ===')
bad = 0
for k, us in sorted(use.items()):
    if k not in st: continue
    t = tn(st[k])
    for u in us:
        if u == '当数组' and not t.startswith('数组'):
            print('  ❌ s.%-16s 前端当数组，线上是 %s' % (k, t)); bad += 1
        if u == '当对象' and not t.startswith('对象'):
            print('  ❌ s.%-16s 前端当对象(.items/.count/.cand)，线上是 %s' % (k, t)); bad += 1
print('  不匹配处数:', bad)

# time 字段类型盘点（下发面板的那些）
print('\n=== 带 time 字段的池：time 的实际类型 ===')
for k in sorted(st.keys()):
    v = st[k]
    if isinstance(v, dict) and 'time' in v:
        print('  %-20s time=%-14s (%s)' % (k, json.dumps(v.get('time'), ensure_ascii=False)[:20], tn(v.get('time'))))
print('\n=== 数字型 time（时间戳）===')
for k in sorted(st.keys()):
    v = st[k]
    if isinstance(v, dict) and isinstance(v.get('time'), (int, float)):
        print('  ⚠ %s.time = %s  ← 数字时间戳，不是 HH:MM:SS' % (k, v.get('time')))
