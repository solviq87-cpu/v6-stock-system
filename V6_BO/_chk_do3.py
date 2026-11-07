# -*- coding: utf-8 -*-
# do 轮实证：把线上真实 /api/state 喂进前端模板里的每个 `s.xxx` 表达式，
#   看有没有 undefined / null / 对象 / 数组 —— 这些渲染出来就是 "undefined"、
#   "[object Object]" 或者 NaN，正是「键的类型与消费方假设不一致」的最终表现。
import json, urllib.request, urllib.parse, ssl, sys, re, io

BASE = 'https://quant-dashboard-77614.app.workbuddy.host'
ctx = ssl.create_default_context()
def post(p, b):
    d = json.dumps(b).encode()
    r = urllib.request.Request(BASE + p, data=d, headers={'Content-Type': 'application/json', 'Connection': 'close'})
    return json.loads(urllib.request.urlopen(r, timeout=60, context=ctx).read().decode())
def get(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + p, headers={'Connection': 'close'}), timeout=60, context=ctx).read().decode())

tok = post('/api/lock/unlock', {'password': 'Libao1314', 'role': 'edit', 'name': 'FPUB_DO03', 'fp': 'FPUBDO03CHK'}).get('deviceToken')
st = get('/api/state?token=' + urllib.parse.quote(tok))

HV = io.open('public/index.html', encoding='utf-8').read()
HL = HV.split('\n')

def resolve(s, expr):
    """只处理 s.a.b.c 与 s.a[b] 这类纯路径；带函数调用的返回 None(跳过)"""
    if not expr.startswith('s'): return None, False
    if re.search(r'[A-Za-z_$]\s*\(', expr): return None, False
    cur = s
    toks = re.findall(r'\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[\'([^\']+)\'\]', expr)
    if not toks: return None, False
    for a, b, c in toks:
        if cur is None: return None, True
        if a:
            if not isinstance(cur, dict) or a not in cur: return None, True
            cur = cur[a]
        elif b:
            if not isinstance(cur, list) or int(b) >= len(cur): return None, True
            cur = cur[int(b)]
        elif c:
            if not isinstance(cur, dict) or c not in cur: return None, True
            cur = cur[c]
    return cur, True

bad = []
n_ok = 0
for m in re.finditer(r'\$\{(s[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[\'[^\']+\'\])*)([^}]*)\}', HV):
    path, rest = m.group(1), m.group(2)
    if rest.strip(): continue          # 带运算/默认值的一律跳过（说明作者已考虑兜底）
    v, okflag = resolve(st, path)
    if not okflag: continue
    line = HV[:m.start()].count('\n') + 1
    if v is None:
        bad.append(('缺失/None', path, line, 'null'))
    elif isinstance(v, (dict, list)):
        bad.append(('非标量', path, line, ('对象' if isinstance(v, dict) else '数组[%d]' % len(v))))
    elif isinstance(v, float) and (v != v):
        bad.append(('NaN', path, line, 'NaN'))
    else:
        n_ok += 1

print('=== 前端模板里「裸插值」的 s.xxx 求值结果 ===')
print('  可用(标量) %d 处 ／ 有问题 %d 处\n' % (n_ok, len(bad)))
for kind, path, line, desc in bad:
    print('  %s  html:%d  ${%s}  → %s' % (kind.ljust(8), line, path, desc))
    print('        %s' % (HL[line - 1].strip()[:120]))
