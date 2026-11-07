# -*- coding: utf-8 -*-
# 升版本号：server.js 与 public/index.html 两处必须一致（不一致 = 前端无限 reload）
# ⛔ 按内容定位（l.startswith('const APP_VER = ')），绝不按固定行号 —— 踩过一次打崩整份文件
import io

NEW = '20261007de'

DESC = (
    '20261007de：同一个承诺在三个入口下兑现得一样吗（本轮新角度）。'
    '面板上写着的「每 N 分钟识别一次」「≥N% 自动推送手机」「实时刷新(12s)」「平台30秒盯盘」'
    '是**承诺** —— 用户照着它安排盯盘；而它与实现分叉时**不报错、不崩、页面照常渲染**，'
    '只是那句话从头错到尾。实测分叉四处：'
    '① 补涨龙**同一个面板两处**各说各的 —— 卡片副标题「≥60%」、动态状态行「≥75%」，实现是 60；'
    '② 大单面板「每2分钟识别一次」，实现是 60 秒（连那行代码自己的注释都还写着"每2分钟"）；'
    '③ 精选池面板「30分钟重算」，实现是 5 分钟；'
    '④ 竞价面板「实时刷新(12s)」，实际主轮询 5 秒、SSE 竞价事件 3 秒推一次。'
    '修法不是"把面板数字改对"（改对了下次还会再分叉），而是**让承诺由实现自己产出**：'
    '周期与阈值全部常量化（TICK_MS / SECTORS_ZT_MS / BIGMONEY_SCAN_MS / POOL_REBUILD_MS / '
    'HOLD_WATCH_MS / AUCTION_REFRESH_S / BUZHANG_PUSH_PROB / ZT_INFER_PUSH_PROB），'
    '由 panelNotes() 一个出口下发，/api/state 带 panelNotes，前端只读不写（旧版 state 有兜底）。'
    '另补两层此前没说的前提：'
    '⛔ **到线只是入选** —— 真要发到手机还得过胜率门（读真实配置）/ 每日条数闸门 / 模块节流，'
    '被拦下不补发；只写「≥60%自动推送」等于承诺了一件做不到的事（补涨龙全天实际最多 2 条）；'
    '⛔ **刷新类承诺只在数据窗口内成立** —— 9:15–15:40 之外（休市 / 夜间）根本不拉，'
    '面板保留最后一次结果，这句现在挂在「30秒刷新 / 60秒刷新」的 title 上。'
    '⛔ 通用教训：凡是"写给人看的规则/周期/阈值"，都要当成一份**契约**来管 —— '
    '契约必须由承诺的兑现方自己产出，不能由展示方另抄一份；'
    '并且只能承诺"入选条件"，不能承诺"必然发生"，除非系统真的没有任何一道闸会拦下它。'
    '守门 _test_promise.js（40 断言：沙箱真跑 panelNotes 九个键与常量逐一对齐、'
    '胜率门改成 70 后说明跟着变、实现侧不许再写死 60/55、六个定时器引用常量、'
    '改常量后承诺句与数值键同时变（反证）、面板 8 处写死数字全部消失、'
    '_pn 定义在首个使用点之前（TDZ 会静默中断整页）、/api/state 只拼一份）。'
    '｜上一版（dd）：系统说的话里，那些「只有结论、没有前提」的话。'
)


def bump(path):
    s = io.open(path, encoding='utf-8', newline='').read()
    lines = s.split('\n')
    hit = 0
    for i, l in enumerate(lines):
        if l.startswith('const APP_VER = '):
            lines[i] = "const APP_VER = '%s'; // %s" % (NEW, DESC)
            hit += 1
    assert hit == 1, (path, hit)
    io.open(path, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
    cr = io.open(path, encoding='utf-8', newline='').read().count('\r')
    print('%s -> %d 处, CRLF=%d' % (path, hit, cr))
    assert cr == 0, 'CRLF 不为 0: ' + path


bump('server.js')
bump('public/index.html')
print('done:', NEW)
