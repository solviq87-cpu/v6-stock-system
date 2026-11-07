# -*- coding: utf-8 -*-
# du 轮升版本：两个文件都改，按内容定位（不按行号）
import io

NOTE = (
    "20261007du：一份数据被截断／归并之后，依赖它的结论还成不成立。"
    "实证一：模拟盘流水有 300 条上限，满 300 后 pop 掉最老的，而对账是拿全流水从头重算现金的 —— "
    "本机真实数据实测：pre 账户丢掉最老 20 笔后，差额从 0 直接变成 37.5 万，被判「账目对不上」，"
    "文案还建议「可用重置清空重来」（会把剩下的几百笔也删掉，不可逆）。真相是证据被丢了，账一点没错。"
    "实证二：pushlog.json 实测已顶到 500/500 条，而「今天已发」闭锁（bt 轮那 11 个）全靠它 —— "
    "单日推送一旦超过上限，当天更早的记录被挤掉，判据静默失效、重复推送。"
    "修法六条：① 容量集中登记 DATA_CAP + 唯一读口 dataCapOf（以前 300／500／200 散落多处，改一处漏一处）"
    "② 归并唯一出口 paperMergeTrades，把 added / dropped / dupDiff 三个数一起交出去 —— "
    "老的 t|code|side 三键会把「同一毫秒同一只票同方向但金额不同」的两笔判成同一笔静默丢掉，"
    "而实测确实存在同一毫秒批量成交（最多 5 笔同 ts）③ 因上限裁掉的笔数必须落进 tradesDropped 留痕，"
    "否则「最老的历史已经被删了」这件事永远没人知道 ④ 对账能区分「证据不全」与「账记错了」："
    "incomplete 时明说无法判定、并明确劝阻重置 ⑤ 面板把「共 N 笔、此处显示最近 M 笔」说清楚 —— "
    "同一个笔数在系统里曾经是 12（前端渲染）／30（接口下发）／全量（对账）三个值 "
    "⑥ pushedToday 先问一句证据够不够覆盖今天。"
    "⛔ 通用教训：下「全量结论」之前必须先问「这份数据全不全」；容器有上限 = 结论有边界，"
    "而边界不说出来，就会被当成不存在。"
)

FILES = ["server.js", "public/index.html"]
for f in FILES:
    p = f
    lines = io.open(p, "r", encoding="utf-8").read().split("\n")
    out = []
    hit = 0
    for l in lines:
        if l.startswith("const APP_VER = "):
            out.append("const APP_VER = '20261007du'; // " + NOTE)
            hit += 1
        else:
            out.append(l)
    io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out))
    print("%s: 替换 %d 处" % (f, hit))
