# -*- coding: utf-8 -*-
# 升版本号：server.js 与 public/index.html 两处必须一致（不一致 = 前端无限 reload）
# ⛔ 按内容定位（l.startswith('const APP_VER = ')），绝不按固定行号 —— 踩过一次打崩整份文件
import io

NEW = '20261007dd'

DESC = (
    '20261007dd：系统说的话里，那些「只有结论、没有前提」的话（本轮新角度）。'
    '系统每天都在给结论 —— 「涨停概率 62%」「参考止损 9.70」「主力净流入 320 万」—— '
    '可它赌的是哪件事、数的是多长时间、跟账户里真正执行的那根线是不是一回事，一句都没交代，'
    '读的人只能自己猜。而猜错的代价是实的：'
    '①「涨停概率」在盘中模块（大单 / 后排蓄势 / 竞价推断 / 补涨龙 / 相似跟随）赌的是【当日】封板，'
    '在板块异动 / 复盘 / 好标的 / 形态赌的是【次日】封板 —— 同一个词、两件事；'
    '而「上涨概率 / 胜率 / 命中率」又是第三个口径（次日最高涨≥HIT_THR%）。'
    '现在由 PROB_DEF 一张表统一定义（ztToday / ztNext / up3Next），probDef / probTag / '
    'probDefOfType 三个出口，数值与定义必须同时出现（数值为 null 或 - 时连定义一起省 —— '
    '没给数就别描述赌的是什么），认不出类型宁可不写；fuseLine 的「学后胜率」按 x.type 自动带定义'
    '（所以 similar / buzhang 两个候选对象必须带 type 字段 —— 少这个字段，那行又变回裸百分数）。'
    '②「净额 320 万」没说统计窗口，而同一张卡片上并列着「1分钟流入」—— 差两个数量级；'
    '净额来自 em.js 的 f62 是当日累计，现在统一带 FLOW_WIN 后缀（净额 / 四级买卖对比 / '
    '板块主力净流入三处）。'
    '③推送里那句「参考止损 X」是写死的现价 -3%，而模拟盘真正执行的是账户里可改的 stopPct'
    '（默认 -8，差 5 个点），注释原来还写「与模拟盘 sl 一致」—— 照 -3% 手动离场、模拟盘却在 -8% 才动，'
    '系统自己跟自己对不上；现在 STOP_REF_PCT 常量化 + stopRefNote() 把两层前提都摊开'
    '（读真实配置，账户改了说明跟着变，不是写死的 8）。'
    '⛔ 通用教训：凡是「一个数字 + 一个名词」的对外陈述，都要问一句「它成立的前提是什么、'
    '失效边界在哪」；前提必须是可复用的定义（改口径只动一处），不是散落在各处的形容词。'
    '守门 _test_premise.js（45 断言：沙箱真跑 probDef / probTag / probDefOfType 三种事件与空值分支、'
    'fuseLine 在三个 type 下的输出、stopRefOf / stopRefNote（含账户止损改成 -5 后说明跟着变、'
    '配置缺字段不出 undefined）、源码全扫「概率 + 百分数」13 处无裸奔且反证生效、'
    '资金窗口三处、前端同一口径 4 条，含 6 条反证）。'
    '｜上一版（dc）：系统对外说的话里，那些「数量词」到底指的是什么。'
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
