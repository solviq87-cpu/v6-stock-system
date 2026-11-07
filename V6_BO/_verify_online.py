# -*- coding: utf-8 -*-
# 真·复盘：不看测试断言，直接问线上实例「现在到底是什么状态」
# 用发布脚本同一个口令走 trust 取一个临时设备令牌（fp 单独命名，收工前撤掉）
import json, io, urllib.request, ssl, gzip

DEV_PWD = "Libao1314"
BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
CTX = ssl.create_default_context()

def post(p, payload):
    req = urllib.request.Request(BASE + p,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip': raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8', 'replace'))

def get(p, tok):
    url = BASE + p + (('&' if '?' in p else '?') + 'token=' + tok)
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip': raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8', 'replace'))

tr = post('/api/lock/trust', {"password": DEV_PWD, "name": "线上复盘", "role": "edit", "fp": "FVERIFY01"})
if not tr.get('ok'):
    print('登录失败:', json.dumps(tr, ensure_ascii=False)[:200]); raise SystemExit(1)
TOK = tr.get('deviceToken') or tr.get('token')
print('已取得线上身份（role=%s，令牌 %d 位）' % (tr.get('role'), len(TOK or '')))

def show(title, d, keys=None):
    print('\n── ' + title + ' ──')
    if not isinstance(d, dict): print('  ' + str(d)[:300]); return
    for k in (keys or list(d.keys())):
        v = d.get(k)
        s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
        if len(s) > 300: s = s[:300] + '…'
        print('  %-14s %s' % (k, s))

# ① 版本 / 角色 / 世代号：世代号没被 bump = 最近几次发版没把自己踢下线
show('① 线上身份 / 版本 / 世代号', get('/api/lock/status', TOK),
     ['appVer', 'pushRole', 'role', 'gen', 'viewGen'])

# ② 设备台账：连发三版后是不是还是同一批设备（令牌跨发版存活）
dv = get('/api/lock/devices', TOK)
if isinstance(dv, dict) and dv.get('ok'):
    ds = dv.get('items') or []   # ⚠️ 字段名是 items 不是 devices
    print('\n── ② 线上设备台账（%d 条）──' % len(ds))
    for x in ds[:14]:
        print('   %-6s %-24s %-20s fp=%s' % (str(x.get('role', '-'))[:6],
              str(x.get('name', '-'))[:24], str(x.get('at', '-'))[:20],
              str(x.get('fp') or '(无)')[:14]))
else:
    show('② 设备台账', dv)

# ③ 真实持仓 + 变更流水 + 快照（一键还原的凭据到底有没有）
hd = get('/api/holdings', TOK)
print('\n── ③ 线上真实持仓 ──')
items = (hd or {}).get('items') or []
print('   条数: %d' % len(items))
for x in items[:8]:
    print('     %s %s 成本%s 股%s' % (x.get('code'), x.get('name'), x.get('cost'), x.get('shares')))
ops = get('/api/holdings/ops?n=15', TOK)
if isinstance(ops, dict) and ops.get('ok'):
    print('\n── ③b 持仓变更流水（最常出事的地方）──')
    for r in (ops.get('ops') or [])[-10:]:
        print('   %-14s %s→%s  删%s' % (r.get('act'), r.get('beforeCount'),
              r.get('afterCount'), (r.get('removed') or [])[:3]))
    snaps = ops.get('snapshots') or []
    print('\n── ③c 一键还原的快照（%d 份）──' % len(snaps))
    for s in snaps[:8]:
        print('   %-44s %2d 条  %s' % (str(s.get('file'))[:44], s.get('count'),
              (s.get('brief') or '')[:34]))

# ④ 推送流水：飞书通道到底还活着吗
pl = get('/api/push-log', TOK)
logs = (pl or {}).get('log') or []   # ⚠️ 字段名是 log 不是 logs
print('\n── ④ 推送流水（共 %d 条，看最近 16 条）──' % ((pl or {}).get('count') or len(logs)))
for r in logs[:16]:
    print('   %-11s %-14s %s' % (str(r.get('time', '-'))[:11],
          str(r.get('status', '-'))[:14],
          str(r.get('title') or r.get('note') or '').replace('\n', ' ')[:52]))
from collections import Counter
c = Counter(str(r.get('status', '?'))[:6] for r in logs)
print('   状态分布(最近%d条): %s' % (len(logs), dict(c)))
bad = [r for r in logs if not str(r.get('status', '')).startswith('✅')]
print('   非"已送达"的 %d 条：' % len(bad))
for r in bad[:8]:
    print('     %-11s %-16s %s' % (str(r.get('time', '-'))[:11], str(r.get('status', '-'))[:16],
          str(r.get('title') or r.get('note') or '').replace('\n', ' ')[:48]))

# ⑤ 各池规模：有没有哪一栏是空的
s = get('/api/state', TOK)
if isinstance(s, dict):
    print('\n── ⑤ 线上各池规模 ──')
    def n(k):
        v = s.get(k)
        if isinstance(v, list): return len(v)
        if isinstance(v, dict): return len(v.get('items') or [])
        return '-'
    for k in ['ztPool', 'pool', 'trendScan', 'steadyUp', 'ztPre', 'bigMoney', 'similar', 'sectors']:
        print('   %-12s %s' % (k, n(k)))

print('\n（复盘用令牌 fp=FVERIFY01，收工前撤掉）')
