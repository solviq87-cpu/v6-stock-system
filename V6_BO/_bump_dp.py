# -*- coding: utf-8 -*-
# dp 轮升版本：20261007do -> 20261007dp
import io, re, sys

NEW_VER = '20261007dp'

NOTE = (
    '20261007dp：同一个数，从算出来到说出来之间被改过几次（本轮新角度 —— do 轮「同一个键名两个值」'
    '再往外一层：**它在传递链上被加工了几道**，算出来 → 存 S → 截断下发 → 前端再取 → 拼进文案。'
    'do/dn 收的是「有几个名字／几个值」，dp 收的是「被改过几次、改成什么、有没有说出去」。'
    '本轮实证两处，方向正好相反：'
    '① **获利盘**：4 个涨停概率调用点里，相邻两行处理同一个「没取到」—— 评分给中性 50，'
    '获利盘却给 0，而 0 是「获利盘 0% = 全员套牢」的**最差档**（中性本该约 50，模型里贡献约 +1.0 的 z）。'
    '概率被系统性压低，面板却照样显示横杠，概率已错而没有任何提示 —— 正是 dh 轮定的「判不出来 ≠ 判了很差」。'
    '② **距涨停点数**：同一个「没取到」在 gap 上把概率往**反方向**推 —— 模型里 gap=0 的含义是'
    '「已在涨停板上」（概率最高档），而预选池那处把限幅**写死成 10**：创业板票涨 5% 真实距涨停 15 点却按 5 点算，'
    'z 白送 2.8（几率比约 16 倍），专挑涨停最活跃的创业/科创/北交所板系统性抬高概率 —— 这就是老朋友'
    '「补写死限幅」的另一个窝点，项目里本来就有按板块判限幅的唯一入口。'
    '③ 更隐蔽的一条：gap 那两处的减法是裸算，pct 取不到时算出 NaN，但模型里那一项的兜底写法会把 NaN'
    '（它是 falsy）悄悄兜成 0 —— 于是「距涨停未知」被当成「已封板」。不报错、不产生 NaN，只是把不知道当成最好。'
    '修法：NUM_NEUTRAL 登记表（每个「缺数据时送进模型的数值」声明自己的中性值，并写明**为什么**是这个值 —— '
    '关键在 profitRatio 与 gap 的中性值必须**反向**：一个不能是 0 因为 0 是最差档，另一个不能是 0 因为 0 是最高档）+ '
    'numNeutral(key, raw) / numGap(code, name, pct) 两个唯一出口（限幅走按板块判定的那个入口，pct 先判空 —— '
    '⛔ 直接转数字会把 null 变成 0，于是「没取到」被当成「今天涨 0%」）+ numGapRaw 可空版本给面板和文案用：'
    '**送进模型的用中性兜底，说给人听的保留空值显示横杠**，不许拿中性值冒充真实数。'
    '文案里「距涨停 X%」原先会把空值打成字面 null，现在取不到就说横杠。'
    '⛔ 通用教训：看到「取不到就给它一个值」就要问两句 —— '
    '（a）**这个兜底值在该字段里是什么档位**？0 对获利盘是最差档、对距涨停是最高档，同一个 0 是相反的两端；'
    '（b）**这个数是要算还是要说**？算用中性兜底没问题，说出去就等于编了一个数。'
    '守门 _test_numneutral.js（89 断言，含反证：老写法把「距涨停未知」当成「已封板」，概率高出数倍）；'
    '扫描器 _scan_dp.js（精度加工／空值兜底／量纲换算／前端二次加工）、_scan_dp2.js（gap 来源与消费／减除法的空值风险）。'
)

def bump(path):
    s = io.open(path, encoding='utf-8').read()
    lines = s.split('\n')
    out, n = [], 0
    for l in lines:
        if l.startswith('const APP_VER = '):
            out.append("const APP_VER = '%s'; // %s" % (NEW_VER, NOTE))
            n += 1
        else:
            out.append(l)
    if n != 1:
        print('FAIL %s: matched %d lines' % (path, n)); sys.exit(1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
    print('OK %s -> %s' % (path, NEW_VER))

bump('server.js')
bump('public/index.html')

# 校验：两端一致 + 无 CRLF
a = io.open('server.js', encoding='utf-8').read()
b = io.open('public/index.html', encoding='utf-8').read()
va = re.search(r"const APP_VER = '([^']+)'", a).group(1)
vb = re.search(r"const APP_VER = '([^']+)'", b).group(1)
if va != vb or va != NEW_VER:
    print('FAIL verify: server=%s html=%s' % (va, vb)); sys.exit(1)
for p in ('server.js', 'public/index.html'):
    cr = io.open(p, encoding='utf-8').read().count('\r')
    if cr: print('FAIL CRLF %s = %d' % (p, cr)); sys.exit(1)
print('VERIFY OK: %s  CRLF=0' % va)
