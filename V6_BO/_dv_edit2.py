# -*- coding: utf-8 -*-
# dv 轮改码②：两个扫描器的淘汰计数 + /api/state 下发
import io

P = "server.js"
src = io.open(P, "r", encoding="utf-8").read()
steps = []

def rep(old, new, want=1):
    global src
    n = src.count(old)
    if n != want:
        steps.append("FAIL(%d!=%d) %s" % (n, want, old[:70].replace("\n", "\\n")))
        return False
    src = src.replace(old, new, want)
    steps.append("OK  %s" % (old[:70].replace("\n", "\\n")))
    return True

# ---------- ① scanZtPre：涨停前形态候选的淘汰原因 ----------
rep(u"""      if (!k || !k.rows) { try { k = JSON.parse(fs.readFileSync(path.join(KLINE_CACHE, fn), 'utf8')); } catch { continue; } }
      const rows = k && k.rows;
      if (!rows || rows.length < 40) continue;""",
u"""      // ⛔ dv 轮：全市场扫描跳过一只票时，必须留下是哪道判据跳的 ——
      //    否则"今天 ztPre 只有 3 只"和"缓存全挂了"在面板上长得一模一样，无从分辨。
      if (!k || !k.rows) { try { k = JSON.parse(fs.readFileSync(path.join(KLINE_CACHE, fn), 'utf8')); } catch { skipAdd('ztNoCache'); continue; } }
      const rows = k && k.rows;
      if (!rows || rows.length < 40) { skipAdd('ztNoKline'); continue; }""")

rep(u"""      if (A.isJunkName(name)) continue;
      if (!(rows[i].close >= 2)) continue;          // 低于 2 元：仙股/退市整理板""",
u"""      if (A.isJunkName(name)) { skipAdd('ztJunk'); continue; }
      if (!(rows[i].close >= 2)) { skipAdd('ztCheap'); continue; }          // 低于 2 元：仙股/退市整理板""")

rep(u"""      if (A.isNearLimitUp(code, name, lastPct, 0.5)) continue;   // 已封板：追不进去
      const lb = A.limitUpStreak(rows, i, code, name, 0.5, 1);
      if (lb >= 4) continue;                        // 4 连板以上不推（用户第十四条）
      const f = ZTPRE.extract(rows, i);
      if (!f) continue;
      const pr = ZTPRE.predict(f, db);
      if (!pr) continue;""",
u"""      if (A.isNearLimitUp(code, name, lastPct, 0.5)) { skipAdd('ztSealed'); continue; }   // 已封板：追不进去
      const lb = A.limitUpStreak(rows, i, code, name, 0.5, 1);
      if (lb >= 4) { skipAdd('ztLianban'); continue; }                        // 4 连板以上不推（用户第十四条）
      const f = ZTPRE.extract(rows, i);
      if (!f) { skipAdd('ztNoFeat'); continue; }
      const pr = ZTPRE.predict(f, db);
      if (!pr) { skipAdd('ztNoPred'); continue; }""")

# ---------- ② scanTrendUniverse：趋势池候选的淘汰原因 ----------
rep(u"""      if (!k || !k.rows) { try { k = JSON.parse(fs.readFileSync(path.join(KLINE_CACHE, fn), 'utf8')); } catch { continue; } }
      const rows = k && k.rows;
      if (!rows || rows.length < 25) continue;""",
u"""      if (!k || !k.rows) { try { k = JSON.parse(fs.readFileSync(path.join(KLINE_CACHE, fn), 'utf8')); } catch { skipAdd('trNoCache'); continue; } }
      const rows = k && k.rows;
      if (!rows || rows.length < 25) { skipAdd('trNoKline'); continue; }""")

rep(u"""      if (A.isJunkName(name)) continue;             // 退市/ST：形态是假的，见 scanZtPre 同款说明
      if (!((rows[i] && rows[i].close) >= 2)) continue;""",
u"""      if (A.isJunkName(name)) { skipAdd('trJunk'); continue; }             // 退市/ST：形态是假的，见 scanZtPre 同款说明
      if (!((rows[i] && rows[i].close) >= 2)) { skipAdd('trCheap'); continue; }""")

rep(u"""      if (A.isNearLimitUp(code, name, lastPct, 0.5)) continue;
      // ② 近期 4 连板以上的不推（用户第十四条明确要求）
      const lb = A.limitUpStreak(rows, i, code, name, 0.5, 1);
      if (lb >= 4) continue;""",
u"""      if (A.isNearLimitUp(code, name, lastPct, 0.5)) { skipAdd('trSealed'); continue; }
      // ② 近期 4 连板以上的不推（用户第十四条明确要求）
      const lb = A.limitUpStreak(rows, i, code, name, 0.5, 1);
      if (lb >= 4) { skipAdd('trLianban'); continue; }""")

rep(u"""      if (_hg.capOk === false || _jv.jumpy) continue;
      const f = LEARNALL.extractFeatures(rows, i, { limitPct, code, name });
      if (!f) continue;
      const pz = LEARNALL.predictML(f, db, 'zt');
      const pu = LEARNALL.predictML(f, db, 'up3');
      if (!pz && !pu) continue;""",
u"""      // 市值不足与上蹿下跳合并在一条判据里，计数时也要照实归到同一类（别拆成两种说法）
      if (_hg.capOk === false || _jv.jumpy) { skipAdd('trHyg'); continue; }
      const f = LEARNALL.extractFeatures(rows, i, { limitPct, code, name });
      if (!f) { skipAdd('trNoFeat'); continue; }
      const pz = LEARNALL.predictML(f, db, 'zt');
      const pu = LEARNALL.predictML(f, db, 'up3');
      if (!pz && !pu) { skipAdd('trNoPred'); continue; }""")

# ---------- ③ /api/state 下发 ----------
rep(u"""      probKind: probKindState(),""",
u"""      probKind: probKindState(),
      // ⛔ dv 轮：静默跳过的账要出得去 —— 面板才能回答"为什么今天只有 3 只"
      //    （而不是让用户对着空白栏猜）。skipStat=全站淘汰统计，empSkip=命中率分母的存活率。
      skipStat: skipState(), empSkip: empSkipStat(),""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))
