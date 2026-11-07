# -*- coding: utf-8 -*-
# du 轮：_test_push_idem 两条断言钉的是写死的 500，改成钉「走登记表」
import io

f = "_test_push_idem.js"
s = io.open(f, "r", encoding="utf-8").read()
pairs = [
    (u"""  ok('pushLog 只保留最近 500 条（当天记录必在其中，不会漏判）',
    /if \\(PUSH_LOG\\.length > 500\\) PUSH_LOG\\.length = 500;/.test(SV));
  ok('流水落盘走 atomicWrite（写坏不会丢整份历史）',
    /atomicWrite\\(PUSH_LOG_FILE, JSON\\.stringify\\(PUSH_LOG\\.slice\\(0, 500\\)\\)\\);/.test(SV));""",
     u"""  // ⛔ du 轮：容量不再写死 500，改走 DATA_CAP 登记表（断言钉语义不钉字面量）
  ok('pushLog 容量走 DATA_CAP 登记表（当天记录必在其中，不会漏判）',
    /if \\(PUSH_LOG\\.length > dataCapOf\\('pushLog'\\)\\) PUSH_LOG\\.length = dataCapOf\\('pushLog'\\);/.test(SV));
  ok('流水落盘走 atomicWrite（写坏不会丢整份历史）',
    /atomicWrite\\(PUSH_LOG_FILE, JSON\\.stringify\\(PUSH_LOG\\.slice\\(0, dataCapOf\\('pushLog'\\)\\)\\)\\);/.test(SV));
  // ⛔ du 轮新增：流水有上限 = 「今天已发」的判据有边界，边界必须被问一句
  ok('pushedToday 会先问证据是否覆盖今天', /pushLogCoversToday\\(\\)/.test(SV));"""),
]
for old, new in pairs:
    n = s.count(old)
    print("命中 %d 处" % n)
    if n == 1:
        s = s.replace(old, new, 1)
io.open(f, "w", encoding="utf-8", newline="\n").write(s)
print("done")
