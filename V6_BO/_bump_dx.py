# -*- coding: utf-8 -*-
# dx 轮：升 APP_VER（两处）
import io, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
OLD = "20261007dw"
NEW = "20261007dx"

NOTE = (
    NEW + u"：配置里的「数值默认值」到底哪个入口认、哪个入口不认。① **自动调参改了主闸不落盘** —— "
    u"三个自学习闭环都会写 S.config 的数值门槛：bigMoneySelfOptimize→bigMoneyProbGate、"
    u"similarSelfOptimize→simGate 写完都调 saveCfg()，唯独 trendSelfOptimize→probThreshold（最要紧的推送主闸）"
    u"改了内存不落盘 → 线上实例被平台回收冷启动 / 发版重启后从 config.json 读回旧值，调参成果整段蒸发；"
    u"而 adjRemember 台账里还记着「从 cur 调到了 nv」→ 台账与现实分叉，复核闸拿错误的 from/to 判「上次上调没改善」。"
    u"② **注释里的默认值与代码分叉** —— /api/config 的注释写着「名额默认120」，而 CFG_RANGE.pushMaxPerDay.def 早已改成 350"
    u"（额度退居兜底、主闸换成胜率门槛那次改的），注释没跟着改，同一数值默认值两个说法。"
    u"其余全扫干净：所有数值配置读取都实时走 _govCfg（无启动期冻结）、白名单 CFG_RANGE/CFG_SET 与读取键一致（无孤儿键）、"
    u"前端面板默认值由后端 cfgRangeState 下发（无硬编码 0.82/55）、自动调参钳制都在取值域内。"
    u"⛔ 通用教训：**「改了内存」和「改了磁盘」是两回事** —— 自学习/自动调参这类程序自己改配置的地方，"
    u"最容易漏 saveCfg()；且注释里的「默认 N」要和登记表 def 对得上，否则又是同一个默认值两种说法。"
)

for f in ['server.js', 'public/index.html']:
    with io.open(f, 'r', encoding='utf-8') as fh:
        lines = fh.readlines()
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '" + NEW + "'; // " + NOTE + "\n"
            hit += 1
    if hit != 1:
        print('FAIL %s :: APP_VER 命中 %d 次' % (f, hit)); sys.exit(1)
    with io.open(f, 'w', encoding='utf-8', newline='\n') as fh:
        fh.writelines(lines)
    print('OK   %s 替换 %d 处' % (f, hit))
print('done')
