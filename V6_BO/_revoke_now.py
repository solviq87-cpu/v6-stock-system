# -*- coding: utf-8 -*-
"""临时脚本：按用户要求清理线上设备台账（只读观看设备 + 我自己脚本造的条目 + 无指纹占位）
保留：FPUB_SYNC*（本地→线上同步身份，只留最新一条）、用户自己的真设备（带随机指纹的 Windows / iPhone）
"""
import json, urllib.request, gzip, time

ON = "https://quant-dashboard-77614.app.workbuddy.host"
PWD = "Libao1314"


def rd(r):
    b = urllib.request.urlopen(r, timeout=30).read()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    return json.loads(b.decode('utf-8'))


def post(p, o):
    return rd(urllib.request.Request(ON + p, data=json.dumps(o).encode(),
                                     headers={'Content-Type': 'application/json'}))


def get(p, tok):
    return rd(urllib.request.Request(ON + p + ('?token=' + tok)))


tr = post('/api/lock/trust', {'password': PWD, 'name': '台账清理', 'role': 'edit', 'fp': 'FCLEAN01'})
TOK = tr.get('deviceToken') or tr.get('token')
print('token ok:', bool(TOK))

# 我脚本自己造的可读指纹（全部清掉）
MINE = ('FVERIFY', 'FRESTORE', 'FUNDO', 'FCHKCE', 'FCLEAN', 'FPUBLISH', 'FLEDGER_TMP', 'FPOST', 'FSRC', 'FDIAG', 'FTEST', 'FBLK', 'FCHK')
# 必须留：同步身份（只留最新一条）与用户真设备
KEEP_FP = {'Fwwdspvlsnjv4', 'F4atcq2v3jdyu'}

items = (get('/api/lock/devices', TOK).get('items') or [])
print('台账共', len(items), '条')

sync = [x for x in items if str(x.get('fp') or '').startswith('FPUB_SYNC')]
sync.sort(key=lambda x: x.get('ts') or 0)
keep_sync = {sync[-1]['id']} if sync else set()
print('保留同步身份:', [ (x.get('fp'), x.get('id')) for x in sync[-1:] ])

todo = []
for it in items:
    i = it.get('id')
    fp = str(it.get('fp') or '')
    role = it.get('role')
    if i in keep_sync:
        continue
    if fp in KEEP_FP:
        continue
    if role == 'view':                      # 用户要求：看盘的只读设备全清
        todo.append((i, 'view 观看设备 ' + str(it.get('name'))))
        continue
    if any(fp.startswith(m) for m in MINE):  # 我脚本造的
        todo.append((i, '我的脚本 ' + fp))
        continue
    if not fp:                               # 无指纹的「自动恢复」占位 / 开发者登录·web
        todo.append((i, '无指纹占位 ' + str(it.get('name'))))
        continue

# 自己的那条最后删
todo.sort(key=lambda x: 0 if not x[0].startswith('') else 0)
mine_last = [t for t in todo if t[0] in ('',) ]
for i, why in todo[:-1]:
    pass

print('\n待撤销 %d 条：' % len(todo))
for i, why in todo:
    print('  -', i, why)

for i, why in todo:
    try:
        r = post('/api/lock/revoke', {'token': TOK, 'id': i})
        print('revoke', i, r.get('ok'), (r.get('msg') or r.get('error') or '')[:50])
    except Exception as e:
        print('revoke', i, 'ERR', str(e)[:80])

time.sleep(1)
left = (get('/api/lock/devices', TOK).get('items') or [])
print('\n清理后台账 %d 条：' % len(left))
for it in left:
    print('  ', it.get('id'), '|', it.get('fp') or '(无)', '|', it.get('name'), '|', it.get('role'))
