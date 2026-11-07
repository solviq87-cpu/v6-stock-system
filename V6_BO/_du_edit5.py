# -*- coding: utf-8 -*-
# du 轮：红灯修复 —— ①告警不阻断判据 ②双实例套件补注入 ③fix0930 改判据（钉的是旧字面量）
import io

def patch(f, pairs):
    s = io.open(f, "r", encoding="utf-8").read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print("  FAIL %s: 命中 %d 处 —— %s" % (f, n, old[:60].replace("\n", "\\n")))
            continue
        s = s.replace(old, new, 1)
        print("  OK   %s: %s" % (f, old[:52].replace("\n", "\\n")))
    io.open(f, "w", encoding="utf-8", newline="\n").write(s)

# ---------- ① server.js：告警包独立 try，不许阻断判据本身 ----------
print("[① server.js]")
patch("server.js", [(u"""    if (!pushLogCoversToday() && _pushLogCapWarnDate !== ds) {
      _pushLogCapWarnDate = ds;
      console.warn('[幂等] ⚠️ 推送流水已满 ' + PUSH_LOG.length + '/' + dataCapOf('pushLog') +
        ' 条，且最老一条就是今天 —— 「今天已发」判据可能查不到更早的记录，有重复推送风险');
    }""",
u"""    // ⛔ 告警不许阻断判据（du 轮）：这一段只是把「证据可能不全」说出来，
    //    它自己失败（或依赖缺失）时必须静默，判据本身照常工作 ——
    //    否则一个日志语句就能让「今天已发」永远返回 false，进而重复推送。
    try {
      if (!pushLogCoversToday() && _pushLogCapWarnDate !== ds) {
        _pushLogCapWarnDate = ds;
        console.warn('[幂等] ⚠️ 推送流水已满 ' + PUSH_LOG.length + '/' + dataCapOf('pushLog') +
          ' 条，且最老一条就是今天 —— 「今天已发」判据可能查不到更早的记录，有重复推送风险');
      }
    } catch (e) { /* 告警失败不影响判据 */ }""")])

# ---------- ② 双实例套件：沙箱补 paperMergeTrades / dataCapOf ----------
print("[② _test_two_instance_parity.js]")
patch("_test_two_instance_parity.js", [
    (u"// 沙箱：注入 _syncGet / PAPER / savePaper / _syncLog / isReplica / S / _pullPaper\nfunction mkPull(opts) {",
     u"""// ⛔ du 轮补：pullPaperDownstream 现在走唯一归并出口 paperMergeTrades（依赖 dataCapOf / DATA_CAP），
//    沙箱漏一个符号 = 整段回拉静默失败（被外层 catch 吞掉，表现为"现金没被覆盖"而不是报错）。
const CAP_SRC = (SV.match(/const DATA_CAP = \\{[\\s\\S]*?\\n\\};/) || [''])[0];
const MERGE_HELPERS = CAP_SRC + '\\n' + fnBody(SV_NOC, 'dataCapOf') + '\\n' +
  fnBody(SV_NOC, 'paperTradeKey') + '\\n' + fnBody(SV_NOC, 'paperMergeTrades') + '\\n';
// 沙箱：注入 _syncGet / PAPER / savePaper / _syncLog / isReplica / S / _pullPaper
function mkPull(opts) {"""),
    (u"""  const fn = new Function('_syncGet', 'PAPER', 'savePaper', '_syncLog', 'isReplica', 'S', '_pullPaper',
    PP + '\\nreturn pullPaperDownstream;')(_syncGet, PAPER,""",
     u"""  const fn = new Function('_syncGet', 'PAPER', 'savePaper', '_syncLog', 'isReplica', 'S', '_pullPaper',
    MERGE_HELPERS + PP + '\\nreturn pullPaperDownstream;')(_syncGet, PAPER,"""),
    (u"  ok('★ 线上新成交被并进来了（去重按 t|code|side）', tr.some(x => x.code === 'N0'));",
     u"  // 判据改钉语义（du 轮）：去重键现在是「成交身份键」t|code|side|shares|amount ——\n"
     u"  //    只有真正同一笔才去重，同一毫秒同票同方向但金额不同的两笔不许被并掉。\n"
     u"  ok('★ 线上新成交被并进来了（同一笔才去重：t|code|side|shares|amount）', tr.some(x => x.code === 'N0'));"),
])

# ---------- ③ fix0930：断言钉的是写死的 500，改成钉"走登记表" ----------
print("[③ _test_fix0930.js]")
patch("_test_fix0930.js", [
    (u"_loaded\\.slice\\(0, 500\\)\\);", u"_loaded\\.slice\\(0, dataCapOf\\('pushLog'\\)\\)\\);"),
    (u"  ok(/PUSH_LOG\\.length > 500\\) PUSH_LOG\\.length = 500/.test(SV), '容量提到 500 条（原 80 条太少）');",
     u"  // ⛔ du 轮：容量不再写死 500，改走 DATA_CAP 登记表（断言钉语义不钉字面量）\n"
     u"  ok(/PUSH_LOG\\.length > dataCapOf\\('pushLog'\\)\\) PUSH_LOG\\.length = dataCapOf\\('pushLog'\\)/.test(SV), '容量走 DATA_CAP 登记表（不再是写死的 500）');"),
])
