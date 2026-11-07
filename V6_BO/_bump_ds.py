# -*- coding: utf-8 -*-
# ds 轮升版本：按内容定位 const APP_VER（不许按行号），两端一起改
import io, sys

NEW_NOTE = (
    "20261007ds：同一个数，在系统里走了一圈之后，还是不是同一个东西"
    "（本轮新角度 —— 前几轮收的是「数本身对不对」：名字、键名、时点、单位；"
    "这一轮换到另一头：**这个数经过登记、加工、落盘、回读之后，下游拿到的还是不是当初那个东西**）。"
    "实证主线：**样本库里同一个字段装了两种东西**。"
    "上一轮（cs 数据血缘）把「精选池技术评分 / 趋势分」接进了 logSignal 的第 5 个参数，"
    "血缘是接上了，但接进去的**不是概率** —— 而下游有三处按「概率」解释它："
    "① 实测重标定按这个值分档 → 评分（集中在 55~80）混进了概率档（集中在 20~65）；"
    "② 概率校准桶 corr 由这个桶算出来，却拿去乘真正的概率；"
    "③ 判定端把评分与概率放进同一道 55 门槛。"
    "「技术评分 70 分」与「涨停概率 70%」是两回事：前者是技术面还行，后者是很看好的票。"
    "混档之后那个实测命中率既不能证明概率准、也不能证明评分灵。"
    "算术实证：概率 70 档实测 60%，混进 100 条评分为 70 的样本（实测 20%）后变成 40% —— "
    "corr 从 0.83 被压到下限 0.70，同一只票的推送分从 58% 掉到 49%，"
    "正好跌破 55 门槛：**一只本该推的票，被另一类样本的白拉挡掉了**。"
    "修法：PROB_KIND 登记表（声明哪个信号类型装的是评分不是概率）+ probKindOf / empKeysOf 唯一出口 —— "
    "评分类走自己的「评分:」档（仍能学习，不浪费上一轮接上的血缘），概率档只数概率样本；"
    "落盘留痕 probKind（旧样本按 type 兜底），并由 /api/state 下发、面板学习表下面同轮接线说明。"
    "⛔ 通用教训：给一个数打通血缘之前，先问**打通的是不是同一个东西** —— "
    "同样是 0~100 的两个刻度（概率 / 评分），数值范围重叠不代表可以进同一个桶；"
    "而「取不到 → 补上」这种修复最容易只补通路不补语义。"
)

TARGETS = [("server.js", "const APP_VER = "), ("public/index.html", "const APP_VER = ")]

for path, prefix in TARGETS:
    with io.open(path, "r", encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    hit = -1
    for i, l in enumerate(lines):
        if l.startswith(prefix):
            hit = i
            break
    if hit < 0:
        print("❌ %s 没找到 %s" % (path, prefix))
        sys.exit(1)
    old = lines[hit]
    lines[hit] = "const APP_VER = '20261007ds'; // " + NEW_NOTE
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))
    print("✓ %s L%d  %s → %s" % (path, hit + 1, old[:40], lines[hit][:40]))
