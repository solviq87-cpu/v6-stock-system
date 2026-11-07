# -*- coding: utf-8 -*-
# dn 轮发布后核验：版本 / outN 实际下发 / 双端一致 / 持仓 0 条 / 设备台账
import json, io, os, urllib.request, urllib.parse, ssl, sys

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
DEV_PWD = 'Libao1314'
ctx = ssl.create_default_context()

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={'Content-Type': 'application/json', 'Connection': 'close'})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return json.loads(r.read().decode('utf-8'))

def get(path):
    req = urllib.request.Request(BASE + path, headers={'Connection': 'close'})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return json.loads(r.read().decode('utf-8'))

# ① 登录拿 token
r = post('/api/lock/unlock', {'password': DEV_PWD, 'role': 'edit', 'name': 'FPUB_DN01', 'fp': 'FPUBDN01CHK'})
print('① unlock:', r.get('ok'), r.get('error', ''), '| token:', ('有' if (r.get('deviceToken') or r.get('token')) else '无'))
TOK = r.get('deviceToken') or r.get('token')
if not TOK:
    print('FAIL 未拿到 token'); sys.exit(1)

# ② /api/state（带 token）
st = get('/api/state?token=' + urllib.parse.quote(TOK))
print('② appVer =', st.get('appVer'), '| pushRole =', st.get('pushRole'))
OUT = st.get('outN')
print('③ outN 下发:', ('有 %d 键' % len(OUT)) if isinstance(OUT, dict) else '❌ 无')
if isinstance(OUT, dict):
    for k, v in OUT.items():
        mark = '← 有货' if (v.get('n') or 0) > 0 else ''
        print('     %-12s %-14s n=%s %s' % (k, v.get('label'), v.get('n'), mark))
TS = st.get('taskState') or {}
print('④ taskState 各模块 n 与 outN 是否同源:')
bad = 0
NAME2POOL = {'ztpre': 'ztpre', 'trendScan': 'trendScan', 'steadyUp': 'steadyUp', 'kbf': 'kbf',
             'bigmoney': 'bigmoney', 'similar': 'similar', 'pre': 'pre'}
for t, p in NAME2POOL.items():
    tn = (TS.get(t) or {}).get('n')
    on = (OUT.get(p) or {}).get('n') if isinstance(OUT, dict) else None
    same = (tn == on)
    if not same: bad += 1
    print('     %-11s taskState.n=%-6s outN.n=%-6s %s' % (t, tn, on, '同源 ✅' if same else '❌ 分叉'))
print('     分叉处数:', bad)

# ⑤ 持仓（必须带 token，否则被私密闸门挡 → 假象）
hd = get('/api/holdings?token=' + urllib.parse.quote(TOK))
items = hd.get('items') if isinstance(hd, dict) else hd
print('⑤ 线上持仓（带 token）=', len(items or []), '条')
PP = st.get('paper')
print('   模拟盘账户:', ('有（positions %d 条）' % len((PP.get('positions') or []))) if isinstance(PP, dict) else '无')

# ⑥ 本地副本一致性
try:
    req = urllib.request.Request('http://127.0.0.1:8787/api/state', headers={'Connection': 'close'})
    with urllib.request.urlopen(req, timeout=30) as r2:
        ls = json.loads(r2.read().decode('utf-8'))
    print('⑥ 本地副本 appVer =', ls.get('appVer'), '| pushRole =', ls.get('pushRole'),
          '| 双端一致:', '✅' if ls.get('appVer') == st.get('appVer') else '❌')
except Exception as e:
    print('⑥ 本地副本读取失败:', e)

# ⑦ 设备台账
dv = post('/api/lock/devices', {'token': TOK}) if True else None
try:
    d = get('/api/lock/devices?token=' + urllib.parse.quote(TOK))
    items = d.get('items') or []
    print('⑦ 设备台账 %d 条:' % len(items))
    for x in items:
        print('     fp=%-18s name=%-14s role=%-5s last=%s' % (x.get('fp') or '(无fp·占位)',
              x.get('name'), x.get('role'), (x.get('last') or '')[:19]))
except Exception as e:
    print('⑦ 台账读取失败:', e)
