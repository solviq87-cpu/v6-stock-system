# -*- coding: utf-8 -*-
# dv 轮升版本：两个文件都改，按内容定位（不按行号）
import io

NOTE = (
    "20261007dv：代码里那些静默跳过（continue / 空 return / 空 catch），跳过时有没有留下为什么。"
    "全项目 160 处 continue、243 处裸 return、176 处空 catch，其中 **145 处 continue 完全静默**"
    "（不计数、不留痕、不告警）。"
    "实证一：**命中率的分母不明** —— 样本库 1959 条只有 368 条（18.8%）进得了实测档："
    "缺次日口径 737、缺概率 242、历史回测 600、事后 12；而 histzt(600)／pool(311)／trend(101)／zt(39)"
    "四类共 1051 条**整类零存活**，面板上这些类型的实测栏永远是空的，谁也分不清"
    "「还没回验」还是「按设计被排除」，只会以为是样本没积累够而干等。"
    "实证二：**paperBuy 五处 continue 静默** —— 面板只说「暂无持仓（等待新信号）」，"
    "真实原因可能是五只候选全因一字板买不进、或现金不足一手，用户无从自查。"
    "修法：登记 SKIP_RULE（27 种跳过原因）+ 唯一出口 skipAdd／skipWhy／skipTop／skipState，"
    "**未登记的 kind 直接丢弃**（逼着新增跳过点先来这里写清原因）；"
    "empTable 两处拆成五类分别计数，交出 empSkipStat（样本存活率与排除原因榜）；"
    "paperBuy 五处、scanZtPre 八处、scanTrendUniverse 九处全部按原因计数；"
    "/api/state 下发 skipStat 与 empSkip；前端学习表补「样本存活」与「跳过台账」两行。"
    "⛔ 通用教训：**跳过不是免费的** —— 每一条 continue 都在改变结论的分母；"
    "只说「跳过了 N 条」没有意义，必须说清是哪道判据跳的、跳了多少，"
    "否则「结果为什么这么少」永远无法自查。"
)

FILES = ["server.js", "public/index.html"]
for f in FILES:
    lines = io.open(f, "r", encoding="utf-8").read().split("\n")
    out = []
    hit = 0
    for l in lines:
        if l.startswith("const APP_VER = "):
            out.append("const APP_VER = '20261007dv'; // " + NOTE)
            hit += 1
        else:
            out.append(l)
    io.open(f, "w", encoding="utf-8", newline="\n").write("\n".join(out))
    print("%s: 替换 %d 处" % (f, hit))
