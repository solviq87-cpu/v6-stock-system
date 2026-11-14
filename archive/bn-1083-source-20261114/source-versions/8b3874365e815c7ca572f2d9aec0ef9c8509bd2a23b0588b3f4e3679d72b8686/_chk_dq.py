# -*- coding: utf-8 -*-
# dq 轮线上核验：版本 / 持仓 / prevSnap 是否真的下发并被前端消费 / 资金留存窗口
import json, urllib.request, urllib.error, urllib.parse

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'

def req(path, method='GET', body=None, timeout=40):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return {'__httpError': e.code}
    except Exception as e:
        return {'__err': str(e)}

print('=== 1. 登录 ===')
u = req('/api/lock/unlock', 'POST', {'password': 'REDACTED_HISTORICAL_LOCK_PASSWORD'})   # ⛔ 字段名是 password
tok = u.get('deviceToken') or u.get('token')
print('  unlock = %s' % bool(tok))
if not tok:
    print('  resp=%s' % json.dumps(u, ensure_ascii=False)[:200]); raise SystemExit(1)

print('\n=== 2. 版本 ===')
st = req('/api/lock/status')
print('  appVer = %s -> %s' % (st.get('appVer'), 'OK' if st.get('appVer') == '20261007dq' else 'MISMATCH'))

print('\n=== 3. 持仓（必须 0 条）===')
h = req('/api/holdings?token=' + urllib.parse.quote(tok))
items = h.get('items') if isinstance(h, dict) else h
n = len(items) if isinstance(items, list) else -1
print('  holdings = %s 条 -> %s' % (n, 'OK' if n == 0 else '⛔ 非零'))

print('\n=== 4. prevSnap 是否真的下发 ===')
s = req('/api/state?token=' + urllib.parse.quote(tok))
ps = s.get('prevSnap')
if not isinstance(ps, dict):
    print('  ⛔ /api/state 里没有 prevSnap')
else:
    print('  prevSnap 键: %s' % list(ps.keys()))
    sf = ps.get('sectorFlow') or {}
    print('  sectorFlow = %s' % json.dumps(sf, ensure_ascii=False))
    print('  usable = %s（今天基线已建立则为 true；休市/刚启动为 false 属正常）' % sf.get('usable'))

print('\n=== 5. 精选池 retain 是否带实际窗口 ===')
pool = s.get('pool') or []
withWin = [x for x in pool if isinstance(x, dict) and x.get('retainWin') != None]
withTxt = [x for x in pool if isinstance(x, dict) and x.get('retainTxt')]
print('  池内 %d 只，其中带 retainWin %d 只、带 retainTxt %d 只' % (len(pool), len(withWin), len(withTxt)))
for x in withTxt[:3]:
    print('    %s %s  retainTxt=%s（retain=%s, win=%ss）'
          % (x.get('code'), x.get('name'), x.get('retainTxt'), x.get('retain'), x.get('retainWin')))
if withWin:
    wins = [x.get('retainWin') for x in withWin]
    print('  实际窗口范围：%ss ~ %ss（名义 600s = 10 分钟）' % (min(wins), max(wins)))

print('\n=== 6. 概率链路 NaN/null 复查 ===')
bad = []
def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items(): walk(v, path + '.' + k)
    elif isinstance(o, list):
        for i, v in enumerate(o[:50]): walk(v, path + '[%d]' % i)
    elif isinstance(o, float) and o != o:
        bad.append((path, 'NaN'))
for key in ('pool', 'trendPool', 'ztPool', 'bigMoney', 'ztPre', 'auction'):
    if key in s: walk(s[key], key)
print('  NaN = %d 处 %s' % (len(bad), bad[:5] if bad else ''))
