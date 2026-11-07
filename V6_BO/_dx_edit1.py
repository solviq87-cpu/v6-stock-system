# -*- coding: utf-8 -*-
# dx 轮：trendSelfOptimize 改 probThreshold 不落盘（另两处自优化都 saveCfg）→ 重启丢调参
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    n = s.count(old)
    if n != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % n)
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % n)
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

SRV = 'server.js'

rep(SRV,
    u"""    const nv = Math.min(+(cur + 0.02).toFixed(2), 0.86);
    S.config.probThreshold = nv;
    adjRemember('trend', { ts: Date.now(), from: cur, to: nv, rate: Math.round(hitRate * 100), n: res.length });""",
    u"""    const nv = Math.min(+(cur + 0.02).toFixed(2), 0.86);
    // ⛔ dx 轮：这里以前只改内存不落盘 —— 另两处自优化（bigMoneySelfOptimize / similarSelfOptimize）
    //    写完都调 saveCfg()，唯独这条最要紧的主闸（probThreshold）不落。线上实例被平台回收冷启动、
    //    或下次发版重启，S.config 从 config.json 读回旧值 → 自动调参的成果整段蒸发，而 adjRemember
    //    台账里却还记着「从 cur 调到了 nv」→ 台账与现实分叉，「复核闸」拿错误的 from/to 判"上次上调没改善"。
    //    saveCfg() 内部失败会走 _diskFail 留痕，无需在此再判返回值。
    S.config.probThreshold = nv; saveCfg();
    adjRemember('trend', { ts: Date.now(), from: cur, to: nv, rate: Math.round(hitRate * 100), n: res.length });""",
    '① 上调分支补 saveCfg')

rep(SRV,
    u"""    const nv = Math.max(+(cur - 0.01).toFixed(2), 0.75);
    S.config.probThreshold = nv;
    noteLearnChange('失败率控制', `推送阈值自动下调至${Math.round(nv * 100)}%`, `跨${st.days}个交易日·${res.length}条信号，beta中性化后命中率${Math.round(hitRate * 100)}%（原始${Math.round(rawRate * 100)}%，>70%优秀线），放宽捕捉提升机会覆盖`);""",
    u"""    const nv = Math.max(+(cur - 0.01).toFixed(2), 0.75);
    S.config.probThreshold = nv; saveCfg();   // dx 轮：同上，下调也要落盘，否则重启后门槛又弹回旧值
    noteLearnChange('失败率控制', `推送阈值自动下调至${Math.round(nv * 100)}%`, `跨${st.days}个交易日·${res.length}条信号，beta中性化后命中率${Math.round(hitRate * 100)}%（原始${Math.round(rawRate * 100)}%，>70%优秀线），放宽捕捉提升机会覆盖`);""",
    '② 下调分支补 saveCfg')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
