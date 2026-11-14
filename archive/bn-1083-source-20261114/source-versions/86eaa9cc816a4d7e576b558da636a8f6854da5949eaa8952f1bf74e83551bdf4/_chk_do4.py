# -*- coding: utf-8 -*-
# do 轮实证（修正版）：解析前端 `const X = s.key` 别名，再对模板里的裸插值求值
import json, urllib.request, urllib.parse, ssl, re, io

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
ctx = ssl.create_default_context()
def post(p, b):
    d = json.dumps(b).encode()
    r = urllib.request.Request(BASE + p, data=d, headers={'Content-Type': 'application/json', 'Connection': 'close'})
    return json.loads(urllib.request.urlopen(r, timeout=60, context=ctx).read().decode())
def get(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + p, headers={'Connection': 'close'}), timeout=60, context=ctx).read().decode())

tok = post('/api/lock/unlock', {'password': 'REDACTED_HISTORICAL_LOCK_PASSWORD', 'role': 'edit', 'name': 'FPUB_DO04', 'fp': 'FPUBDO04CHK'}).get('deviceToken')
st = get('/api/state?token=' + urllib.parse.quote(tok))
HV = io.open('public/index.html', encoding='utf-8').read()
HL = HV.split('\n')

# ① 别名表：const X = s.key... / const X = s.key || ...
alias = {}
for m in re.finditer(r'\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(s[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\|\||;|,|\n)', HV):
    alias[m.group(1)] = m.group(2)
print('① 别名表 %d 条:', len(alias))
for k, v in list(alias.items())[:40]:
    print('     %-10s = %s' % (k, v))

def resolve(root, expr):
    """root 是起始对象；expr 形如 s.a.b / X.a.b（X 是别名）"""
    head = re.match(r'([A-Za-z_$][\w$]*)', expr).group(1)
    if head == 's': cur = root
    elif head in alias:
        base = resolve(root, alias[head])
        cur = base[0] if isinstance(base, tuple) else base
        if cur is None: return None
    else: return None
    rest = expr[len(head):]
    for a, b in re.findall(r'\.([A-Za-z_$][\w$]*)|\[(\d+)\]', rest):
        if cur is None: return None
        if a:
            if isinstance(cur, dict):
                if a not in cur: return None
                cur = cur[a]
            elif isinstance(cur, list) and a == 'length': cur = len(cur)
            else: return None
        else:
            if not isinstance(cur, list) or int(b) >= len(cur): return None
            cur = cur[int(b)]
    return cur

bad, ok_n = [], 0
pat = re.compile(r'\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}')
for m in pat.finditer(HV):
    expr = m.group(1)
    head = re.match(r'([A-Za-z_$][\w$]*)', expr).group(1)
    if head != 's' and head not in alias: continue
    if re.search(r'[A-Za-z_$]\s*\(', expr): continue
    v = resolve(st, expr)
    line = HV[:m.start()].count('\n') + 1
    if v is None: bad.append(('缺失/null', expr, line, 'null'))
    elif isinstance(v, dict): bad.append(('对象', expr, line, '对象{%s}' % ','.join(list(v.keys())[:3])))
    elif isinstance(v, list): bad.append(('数组', expr, line, '数组[%d]' % len(v)))
    elif isinstance(v, float) and v != v: bad.append(('NaN', expr, line, 'NaN'))
    else: ok_n += 1

print('\n=== 裸插值求值：可用 %d 处 ／ 有问题 %d 处 ===\n' % (ok_n, len(bad)))
seen = set()
for kind, expr, line, desc in bad:
    k = (kind, expr)
    if k in seen: continue
    seen.add(k)
    print('  %-10s html:%-5d %-34s → %s' % (kind, line, expr, desc))
    print('       %s' % HL[line - 1].strip()[:118])
