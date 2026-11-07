# dj 轮：升版本 20261007di -> 20261007dj（按内容定位）+ 登记发布清单
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def bump(s, tag):
    out, n = [], 0
    for l in s.split('\n'):
        if l.startswith('const APP_VER = '):
            old = l
            l = l.replace("'20261007di'", "'20261007dj'")
            n += 1
            print('  %s: %s -> %s' % (tag, old[:40], l[:40]))
        out.append(l)
    if n != 1:
        print('  !! %s APP_VER 命中 %d 次（应 1）' % (tag, n)); sys.exit(1)
    return '\n'.join(out)

rw('server.js', lambda s: bump(s, 'server.js'))
rw('public/index.html', lambda s: bump(s, 'index.html'))

NEW = [
    ('_test_win.js', u'# 守门测试：同一个「最近 N 日」在系统里是不是同一个窗口（2026-10-07 dj，本轮新角度）—— 系统里到处在说「近3日/近20日/60日高点/90日内涨停/95日低点」，而实现是 slice(-N) 切最近 N 根 K 线：**名义窗口是 N，实际窗口是 min(N, 手里有几根)**。数据不足时窗口会静默变短 —— slice(-90) 在只有 6 根时算的是「6 日内涨停几次」，文案却照写「90日内1次涨停」：用户会以为这票三个月才板过一次（弱），真相是它只有 6 天数据、6 天里板了 1 次（其实很猛）。⛔ 反向也一样：low95 原来是 `Math.min(...k.rows.map(r => r.low))` **根本没切 95 根**，数据 200 根时算的是「200 日低点」—— 名不副实两头都占。修法：WIN_RULE 登记表（11 个窗口的名义长度与含义）+ winLabel（主说法）/ winShort（不足时的尾巴）唯一出口；实际窗口随值返回（hi60Win / zt60Win / zt90Win，di 轮埋的 basis.zt90Win 正好接上）；趋势池文案、低位启动、盘口「N板」、面板「判定规则」悬浮说明全部改走出口。测试沙箱真跑 WIN_RULE + 直连 analysis.js 的 trendPoolCheck（66 断言），含反证：200 根数据下旧写法与新写法取到的低点确实不同'),
    ('_scan_dj.js', u'# 扫描器：dj 轮配套体检 —— ① 所有 slice(-N) 的窗口清单（2/3/4/5/6/8/10/11/20/21/60/80/90/600/1500）② 窗口的「日」是交易日还是自然日 ③ 对外文案写的「近N日/N日内」与实现是否同数 ④ 运行时各池子窗口不满的情况'),
]

def add(s):
    lines = s.split('\n')
    idx = None
    for i, l in enumerate(lines):
        if '"_scan_di2.js"' in l:
            idx = i
            break
    if idx is None:
        print('  !! 找不到 _scan_di2.js 锚点'); sys.exit(1)
    indent = lines[idx][:len(lines[idx]) - len(lines[idx].lstrip())]
    ins = ['%s"%s",  %s' % (indent, name, note) for name, note in NEW]
    lines[idx + 1:idx + 1] = ins
    print('  插入 %d 行' % len(ins))
    return '\n'.join(lines)

rw('_publish.py', add)
print('全部完成')
