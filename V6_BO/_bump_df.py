# -*- coding: utf-8 -*-
# df 轮：升 APP_VER（两处必须一致，否则前端无限 reload）
# ⛔ 按内容定位 `const APP_VER = `，绝不按行号（固定行号会打崩文件）
import io, os, sys

NEW_VER = '20261007df'
NOTE = (
    '20261007df：承诺了但没有任何一条路径会去兑现（本轮新角度）。'
    '系统里有多处明写着「嫌吵可在面板关掉」（9:20 竞价预览，server.js 竞价预览定时器）、'
    '「请检查面板的静默时段设置」（推送自检诊断的 verdict）、「可配 config.viewIdleHours」（只读设备过期）——'
    '但 public/index.html 里**一个入口都没有**，/api/config 也只认 CFG_RANGE 那 11 个数字键'
    '（不在表里连 _cfgIn 都进不去 → 不报错、不落盘，接口照样回 ok:true），全项目零写入点。'
    '后果是用户要么永远关不掉那条推送，要么只能手改 config.json 再重启，而那句提示压根没告诉他；'
    '最讽刺的是诊断里那句「请检查面板的静默时段设置」会被推送到手机上，用户照着做却发现面板上没有这项。'
    '这类故障不报错、不崩溃、面板照常显示 —— 只是那句话从头到尾是空的。'
    '修法：把这类键收进 CFG_SET（kind=bool/hhmm/int + def + label + note），'
    '① 读取唯一入口 cfgSetOf（没设过或值坏了都退回缺省；⛔ 上界在读取端也要兜住 —— '
    'config.json 是手改得动的文件，里面躺着 9999 时不能让它真生效，写入端拦得住新值拦不住老文件）；'
    '② 写入端 cfgSetErrors 先体检再落盘，沿用 CFG_RANGE 那条「格式错必须报错、原样保留、整批不写」，'
    '⛔ int 的下界是 0 而不是 min —— 0 的含义是「交回使用端解释」（viewIdleHours 的 0 = 按缺省 24 走），'
    '别重蹈 aq 轮「0 被 || 吃掉 / 被当成越界」的覆辙；'
    '③ /api/state 下发 cfgSet，面板「🛠 工具 → ⏱ 推送时段 / 开关」由它渲染，'
    '名称与说明全部由兑现方产出、前端只读不写（de 轮「契约由兑现方产出」那条原则）；'
    '④ 静默时段抽成唯一出口 quietWindow()，面板 / inQuietHours / pushAll 三处同读，不许各拼一份；'
    '⑤ 面板输入中不重绘（refresh 每 5 秒一次会冲掉正在敲的内容）、保存失败念出服务端原因并回绘真实值。'
    '⛔ 通用教训：写「可在面板 X」之前先问一句 —— 这张表里登记了吗？面板读得到吗？接口收得下吗？'
    '守门 _test_cfgset.js（58 断言，含一组反证：旧白名单 CFG_RANGE 里根本没有这四个键）；'
    '配套扫描器 _scan_deadswitch.js / _scan_df.js。'
)

FILES = ['server.js', 'public/index.html']
for f in FILES:
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), f)
    with io.open(p, 'r', encoding='utf-8', newline='') as fh:
        lines = fh.read().split('\n')
    hit = -1
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            hit = i
            break
    if hit < 0:
        print('!! 未找到 APP_VER 行: ' + f)
        sys.exit(1)
    lines[hit] = "const APP_VER = '%s'; // %s" % (NEW_VER, NOTE)
    with io.open(p, 'w', encoding='utf-8', newline='') as fh:
        fh.write('\n'.join(lines))
    crlf = open(p, 'rb').read().count(b'\r')
    print('  %s -> %s (行 %d, CRLF=%d)' % (f, NEW_VER, hit + 1, crlf))
print('  版本已升到 ' + NEW_VER)
