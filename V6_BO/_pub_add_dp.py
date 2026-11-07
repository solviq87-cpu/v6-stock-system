# -*- coding: utf-8 -*-
# 把 dp 轮新增文件登记进 _publish.py 的 CODE_FILES
import io, sys

P = '_publish.py'
s = io.open(P, encoding='utf-8').read()

ANCHOR = '              "_chk_do4.py",'
ADD = (
    '              "_test_numneutral.js",  # 守门测试：dp 轮 —— 同一个数从算出来到说出来之间被改过几次。'
    '实证两个方向相反的兜底：① 获利盘取不到给 0，而 0 是「获利盘 0% = 全员套牢」的最差档（中性该约 50），'
    '概率被压低且面板照样显示横杠；② 距涨停点数取不到也给 0，而 gap=0 的含义是「已封板」= 概率最高档，'
    '于是概率被抬高；且预选池那处把限幅写死成 10，创业板票真实距涨停 15 点却按 5 点算（z 白送 2.8）。'
    '修法 NUM_NEUTRAL 登记表（每个缺数据字段声明中性值并写明为什么 —— profitRatio 与 gap 的中性值必须反向，'
    '一个不能是 0 因为 0 是最差档、另一个不能是 0 因为 0 是最高档）+ numNeutral/numGap 唯一出口'
    '（限幅走按板块判定的入口，pct 先判空 —— 直接转数字会把 null 变成 0，于是「没取到」被当成「今天涨 0%」）'
    '+ numGapRaw 可空版本给文案用（送模型用中性兜底，说给人听的保留空值显示横杠）。'
    '沙箱真跑（89 断言），含反证：老写法把「距涨停未知」当成「已封板」，概率高出数倍\n'
    '              "_scan_dp.js",  # 扫描器：dp 轮第一遍 —— 六维：被定精度的字段分布、参与比较的空值兜底、'
    '量纲换算、前端二次加工、取整钳位、日志数量词\n'
    '              "_scan_dp2.js",  # 扫描器：dp 轮第二遍 —— gap 来源与消费、定精度后再参与算术、减除法的空值风险、'
    '概率乘百后再取整（两道加工）、前端渲染时二次定精度\n'
)

n = s.count(ANCHOR)
if n != 1:
    print('FAIL: anchor count = %d' % n); sys.exit(1)
s = s.replace(ANCHOR, ANCHOR + '\n' + ADD, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK: 3 个文件已登记进 CODE_FILES')
