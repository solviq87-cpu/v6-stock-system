# -*- coding: utf-8 -*-
# dn 轮补漏：连续收涨面板仍在自己数 su.length（与任务状态两条代码路径）
import io, sys
P = 'public/index.html'
s = io.open(P, encoding='utf-8').read()
OLD = "document.getElementById('suInfo').textContent = `全市场扫出 ${su.length} 只符合条件的连续收涨`"
NEW = "document.getElementById('suInfo').textContent = `全市场扫出 ${poolN(s, 'steadyUp', su.length)} 只符合条件的连续收涨`"
n = s.count(OLD)
if n != 1:
    print('FAIL count=%d' % n); sys.exit(1)
s = s.replace(OLD, NEW)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK  suInfo -> poolN')
print('poolN 出现次数:', s.count('poolN(s,'))
print('CR:', s.count('\r'))
