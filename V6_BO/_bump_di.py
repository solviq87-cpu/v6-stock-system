# di 轮：升版本 20261007dh -> 20261007di（按内容定位，不用固定行号）+ 登记发布清单
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def bump(s, tag):
    out = []
    n = 0
    for l in s.split('\n'):
        if l.startswith('const APP_VER = '):
            old = l
            l = "const APP_VER = '20261007di';" + l[l.index(';'):][1:] if False else l.replace("'20261007dh'", "'20261007di'")
            n += 1
            print('  %s: %s -> %s' % (tag, old[:40], l[:40]))
        out.append(l)
    if n != 1:
        print('  !! %s APP_VER 命中 %d 次（应 1）' % (tag, n)); sys.exit(1)
    return '\n'.join(out)

rw('server.js', lambda s: bump(s, 'server.js'))
rw('public/index.html', lambda s: bump(s, 'index.html'))

# ── 登记发布清单 ──
NEW = [
    ('_test_need.js', u'# 守门测试：同一个「够了/达标」在系统里是不是同一把尺子（2026-10-07 di，本轮新角度）—— 全项目到处都在判"够不够"：K 线 5/6/8/12/21/25/30/40/45/60/100 根、评分线 75、胜率门 55、市值 50 亿……实测门槛散在 11 种写法里。最隐蔽的是评分本身：入池只要 5 根，而 scoreStock 的分项（获利盘要 5 根、90 日涨停基因要 90 根）在短数据下天然残缺 —— 同一个 62 分，A 票是「8 项全算过」的 62，B 票是「只算过 4 项」的 62，同池排序、同比那条评分线 75，量的是两把尺子且没人说。修法：NEED_RULE 登记表（每个门槛写清保护什么 + 不够时怎么办 skip/null/partial/zero）+ needOf/needLess 唯一读取口；scoreStock 随分返回 basis（rows/avail/missing/partial/zt90Win），⛔ 无 K 线时由 `score: 0` 改为 `score: null`（0 是真实低分，会参与排序与达标判定 = 用「判了很差」冒充「没判」）；scoreNoteOf 唯一出口把「几根 K 线、按多少满分算的」如实说给用户，前端在分数旁标「⚠评分未满项」。测试沙箱真跑 NEED_RULE + 直连 analysis.js（85 断言），含反证：短数据票的满分确实更低'),
    ('_scan_di.js', u'# 扫描器：di 轮配套体检 —— ① 序列长度门槛（谁在判几根才够，散落 2/3/5/6/8/12/21/25/30/40/60/100/200）② 各类数值达标线 ③「数据不足/至少需要」类说法 ④ 运行时各池子票数'),
    ('_scan_di2.js', u'# 扫描器：di 轮第二遍 —— 入池门槛 vs 算法自带门槛对照（calcProfitRatio 5 / hengPanFangLiang 12 / trendHygiene 21 / trendCheck 25 / ztpre 40 / backtest 45 / weeklyCross 60）'),
]

def add(s):
    lines = s.split('\n')
    idx = None
    for i, l in enumerate(lines):
        if '"_scan_dh.js"' in l:
            idx = i
            break
    if idx is None:
        print('  !! 找不到 _scan_dh.js 锚点'); sys.exit(1)
    indent = lines[idx][:len(lines[idx]) - len(lines[idx].lstrip())]
    ins = ['%s"%s",  %s' % (indent, name, note) for name, note in NEW]
    lines[idx + 1:idx + 1] = ins
    print('  插入 %d 行到 _scan_dh.js 之后' % len(ins))
    return '\n'.join(lines)

rw('_publish.py', add)
print('全部完成')
