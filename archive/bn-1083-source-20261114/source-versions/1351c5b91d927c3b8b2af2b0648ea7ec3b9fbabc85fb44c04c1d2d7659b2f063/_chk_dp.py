# -*- coding: utf-8 -*-
# dp 轮线上核验：版本 / 持仓 / 概率链路有没有 NaN 或 null 泄漏 / 新增键是否下发
import json, urllib.request, urllib.error, ssl, sys

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
CTX = ssl.create_default_context()

def req(path, method='GET', body=None, timeout=40):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=CTX) as resp:
            return json.loads(resp.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return {'__httpError': e.code, 'body': e.read().decode('utf-8', 'replace')[:200]}
    except Exception as e:
        return {'__err': str(e)}

print('=== 1. 登录拿 token ===')
# ⛔ 字段名是 password 不是 pwd
u = req('/api/lock/unlock', 'POST', {'password': 'REDACTED_HISTORICAL_LOCK_PASSWORD'})
tok = u.get('deviceToken') or u.get('token')
print('  unlock ok = %s' % bool(tok))
if not tok:
    print('  resp = %s' % json.dumps(u, ensure_ascii=False)[:300]); sys.exit(1)

print('\n=== 2. 版本 ===')
st = req('/api/lock/status')
print('  appVer = %s' % st.get('appVer'))
print('  APP_VER 期望 20261007dp -> %s' % ('OK' if st.get('appVer') == '20261007dp' else 'MISMATCH'))

print('\n=== 3. 持仓（必须 0 条，带 token）===')
h = req('/api/holdings?token=' + tok)
if isinstance(h, list):
    print('  holdings = %d 条  -> %s' % (len(h), 'OK' if len(h) == 0 else '⛔ 非零'))
elif isinstance(h, dict):
    for k in ('holdings', 'items', 'list', 'data'):
        if isinstance(h.get(k), list):
            print('  holdings[%s] = %d 条 -> %s' % (k, len(h[k]), 'OK' if len(h[k]) == 0 else '⛔ 非零'))
            break
    else:
        print('  holdings = %s' % json.dumps(h, ensure_ascii=False)[:300])
else:
    print('  holdings = %s' % str(h)[:300])

print('\n=== 4. /api/state：新增键是否下发 + 概率链路有没有 NaN/null ===')
s = req('/api/state?token=' + tok)
if not isinstance(s, dict):
    print('  state 不是对象: %s' % str(s)[:200]); sys.exit(1)

for k in ('stateCut', 'outN', 'appVer'):
    print('  %-10s %s' % (k, '有' if k in s else '（/api/state 不下发 appVer 属正常）' if k == 'appVer' else '⛔ 缺失'))
if isinstance(s.get('stateCut'), dict):
    print('  stateCut 键数 = %d' % len(s['stateCut']))

# 概率链路：把 state 里所有叫 prob/probC/riseProb 的数字捞出来看有没有 NaN / null / 负数
bad = []
def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items(): walk(v, path + '.' + k)
    elif isinstance(o, list):
        for i, v in enumerate(o[:50]): walk(v, path + '[%d]' % i)
    elif isinstance(o, float) and o != o:
        bad.append((path, 'NaN'))
    elif o is None and any(t in path.lower() for t in ('prob', 'gaptolimit')):
        bad.append((path, 'null'))
for key in ('pool', 'trendPool', 'ztPool', 'bigMoney', 'candidatePool', 'ztPre', 'steadyUp', 'auction'):
    if key in s: walk(s[key], key)
print('  概率/距涨停字段里的 NaN 或 null：%d 处 %s' % (len(bad), bad[:6] if bad else ''))

# 数值合理性：概率应在 0~100
rng = []
def walk2(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('prob', 'probC', 'riseProb') and isinstance(v, (int, float)):
                if not (0 <= v <= 100): rng.append((path + '.' + k, v))
            walk2(v, path + '.' + k)
    elif isinstance(o, list):
        for i, v in enumerate(o[:50]): walk2(v, path + '[%d]' % i)
for key in ('pool', 'trendPool', 'bigMoney', 'ztPre', 'auction'):
    if key in s: walk2(s[key], key)
print('  越界概率（不在 0~100）：%d 处 %s' % (len(rng), rng[:6] if rng else ''))

print('\n=== 5. 台账（授权设备）===')
d = req('/api/lock/devices?token=' + tok) if tok else None
if isinstance(d, dict):
    arr = d.get('devices') or d.get('list') or []
    print('  设备数 = %d' % len(arr))
    for x in arr[:20]:
        print('    id=%s fp=%s name=%s' % (str(x.get('id'))[:28], str(x.get('fp'))[:22], str(x.get('name'))[:20]))
elif isinstance(d, list):
    print('  设备数 = %d' % len(d))
    for x in d[:20]:
        print('    id=%s fp=%s name=%s' % (str(x.get('id'))[:28], str(x.get('fp'))[:22], str(x.get('name'))[:20]))
else:
    print('  devices = %s' % str(d)[:200])
