# -*- coding: utf-8 -*-
"""修复上一轮误写入的 SystemExit 提示块（\n 被 shell 吃成了真换行），并校验语法。"""
import ast

F = '_publish.py'
lines = open(F, encoding='utf-8').read().split('\n')

# 定位 raise SystemExit 那一段（第 133-158 行，1-based）
start = None
for i, ln in enumerate(lines):
    if 'raise SystemExit(' in ln and i > 100:
        start = i
        break
assert start is not None, '找不到 raise SystemExit 起点'
end = None
for j in range(start, len(lines)):
    # 结束行形如:  '                    "=" * 68 + "\n")'
    if lines[j].rstrip() == '")':
        end = j
        break
assert end is not None, '找不到结束的 )'
print('修正范围(1-based): %d ~ %d' % (start + 1, end + 1))

block = '''                raise SystemExit(
                    "\\n" + "=" * 68 + "\\n"
                    "🛑 发布已中止：线上持仓是【空】的，本地却有 %d 条\\n" % _ln +
                    "=" * 68 + "\\n"
                    "  这不像你自己删了仓（那会两端都空），更像线上的数据凭空消失了。\\n"
                    "  若直接发下去，本地那份好的也会被空版本覆盖 —— 就是所谓「又没有了」。\\n\\n"
                    "  本地完好的那份已留存: %s\\n" % keep +
                    "  请三选一：\\n"
                    "   ① 确认线上确实该是空的 → 加参数 --force-empty-holdings 重跑\\n"
                    "   ② 想把本地这份救回线上 → 走面板「持仓 → 变更记录」一键还原\\n"
                    "   ③ 都不确定 → 先别发，告诉我，我来查是谁清的\\n" +
                    "=" * 68 + "\\n")'''

new = lines[:start] + block.split('\n') + lines[end + 1:]
src = '\n'.join(new)
ast.parse(src)
open(F, 'w', encoding='utf-8', newline='\n').write(src)
print('✅ 已修复并通过语法校验')
