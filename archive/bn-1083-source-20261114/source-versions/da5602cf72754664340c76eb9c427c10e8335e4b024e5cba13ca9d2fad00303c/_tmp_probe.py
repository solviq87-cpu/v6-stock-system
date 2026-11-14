import json, sys
d = json.load(open('_tmp_export.json', encoding='utf-8'))
print('ok:', d.get('ok'), '| appVer:', d.get('appVer'), '| ts:', d.get('ts'))
f = d.get('files') or {}
print('export file keys:', sorted(f.keys()))
for k in sorted(f.keys()):
    v = f.get(k)
    if v is None:
        print('  %-22s -> None' % k)
    elif isinstance(v, dict):
        print('  %-22s -> dict keys=%d' % (k, len(v)))
    elif isinstance(v, list):
        print('  %-22s -> list len=%d' % (k, len(v)))
    else:
        print('  %-22s -> %s' % (k, type(v).__name__))
c = f.get('config.json')
if isinstance(c, dict):
    print('config.json pushRole =', repr(c.get('pushRole')))
    su = c.get('syncUpstream')
    print('config.json syncUpstream =', repr(su)[:120])
    print('config.json top keys:', sorted(c.keys()))
else:
    print('config.json MISSING or not dict ->', type(c).__name__)
pl = f.get('pushlog.json')
if isinstance(pl, dict):
    items = pl.get('items') or pl.get('log') or []
    if isinstance(items, list):
        sent = [x for x in items if isinstance(x, dict) and x.get('ok')]
        print('pushlog items=%d sent=%d' % (len(items), len(sent)))
        for x in items[-3:]:
            print('   last:', str(x)[:160])
elif isinstance(pl, list):
    print('pushlog list len=%d' % len(pl))
