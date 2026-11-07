import json, ssl, urllib.request, urllib.parse

cfg = json.load(open('config.json', encoding='utf-8'))
su = cfg.get('syncUpstream') or {}
BASE = (su.get('url') or '').rstrip('/')
TOK = su.get('token') or ''
ctx = ssl.create_default_context()


def get(path, tok=True):
    q = '?' + urllib.parse.urlencode({'token': TOK}) if tok else ''
    req = urllib.request.Request(BASE + path + q, method='GET', headers={'User-Agent': 'diag'})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.loads(r.read().decode('utf-8'))


st = get('/api/state')
print('appVer =', st.get('loop', {}), )
loop = st.get('loop') or {}
print('loop =', json.dumps(loop, ensure_ascii=False))
pg = st.get('pushGov') or {}
print('pushGov =', json.dumps(pg, ensure_ascii=False))
print('\n>>> 今日已推 %s 只，被压 %s 条，余量 %s' % (pg.get('used'), pg.get('dropped'), pg.get('left')))
sig = st.get('signals') or []
if sig:
    import datetime
    last = max((x.get('ts') or 0) for x in sig)
    print('最后一条信号时间 =', datetime.datetime.fromtimestamp(last / 1000).strftime('%H:%M:%S'))
print('now =', datetime.datetime.now().strftime('%H:%M:%S') )
