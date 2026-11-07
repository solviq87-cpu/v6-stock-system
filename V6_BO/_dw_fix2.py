# -*- coding: utf-8 -*-
# dw 轮 · 自查补丁：4 处逻辑缺口
#  ① 前端漏掉「数据缺口跳过卡到机会用尽」的补救失败 → 改服务端统一算 bad（兑现方自己产出）
#  ② _reviewStartupCheck 补发成功 / 算出 0 条 都不登记 → 补 remedyDone
#  ③ _bootSeed 的 catch 吞掉 seed 异常，没登记补救失败 → 补 remedyDone({ok:false})
#  ④ 前端 bad 过滤与「ok===false 已覆盖 busy/err」重复且漏 gap → 改读 rm[k].bad
import io, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def rd(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep(path, old, new, tag):
    s = rd(path)
    n = s.count(old)
    if n != 1:
        FAILS.append(tag + ' :: 锚点命中 %d 次' % n)
        print('FAIL ' + tag + ' :: 锚点命中 %d 次' % n)
        return
    wr(path, s.replace(old, new))
    print('OK   ' + tag)

SRV = 'server.js'
HTML = 'public/index.html'

# ── ① 服务端统一算 bad ──
rep(SRV,
    u"""// 「这次机会被跳过」的原因（按动作分）
const REMEDY_SKIP = {
  bootScanNoDb:    '学习库还没加载完',
  bootSeedEnough:  '样本已够 20 条（不需要补）',
  reviewWeekend:   '周末（按设计不补）',
  reviewNotTrade:  '休市日（按设计不补）',
  reviewOffWin:    '不在收盘后窗口（15:30-23:59）',
  reviewAlready:   '当天已发过',
  reviewBusy:      '上一轮复盘还在跑',
  reviewNoPool:    '涨停池为空（数据没回来）'
};""",
    u"""// 「这次机会被跳过」的原因（按动作分）
const REMEDY_SKIP = {
  bootScanNoDb:    '学习库还没加载完',
  bootSeedEnough:  '样本已够 20 条（不需要补）',
  reviewWeekend:   '周末（按设计不补）',
  reviewNotTrade:  '休市日（按设计不补）',
  reviewOffWin:    '不在收盘后窗口（15:30-23:59）',
  reviewAlready:   '当天已发过',
  reviewBusy:      '上一轮复盘还在跑',
  reviewNoPool:    '涨停池为空（数据没回来）'
};
// ⛔ 「按设计跳过」与「数据没回来跳过」必须分开：前者（休市/周末/已发过）不算补救失败；
//    后者（学习库没加载 / 复盘还没跑完 / 涨停池没回来）卡到机会用尽，就是补救失败，必须提醒。
const REMEDY_GAP = new Set(['bootScanNoDb', 'reviewBusy', 'reviewNoPool']);
function remedyBadOf(k) {
  const g = _remedy[k], R = REMEDY_RULE[k];
  if (!g || !g.used) return false;
  if (g.ok === false) return true;                 // 跑了但失败
  if (g.why === 'zero') return true;               // 跑了但 0 条
  if (g.ok === null && REMEDY_GAP.has(g.why) && (!R.tries || g.used >= R.tries)) return true; // 全程卡在数据缺口，机会已尽
  return false;
}""",
    '① REMEDY_GAP + remedyBadOf')

rep(SRV,
    u"""    o[k] = { label: R.label, tries: R.tries, used: g.used, ok: g.ok, why: g.why,
             whyLabel: remedyWhyOf(g.why), n: g.n, at: g.at,
             left: R.tries ? Math.max(0, R.tries - g.used) : null, note: remedyNote(k) };""",
    u"""    o[k] = { label: R.label, tries: R.tries, used: g.used, ok: g.ok, why: g.why,
             whyLabel: remedyWhyOf(g.why), n: g.n, at: g.at,
             left: R.tries ? Math.max(0, R.tries - g.used) : null, note: remedyNote(k),
             bad: remedyBadOf(k) };""",
    '①b remedyState 下发 bad')

# ── ② _reviewStartupCheck 补发成功 / 0 条 ──
rep(SRV,
    u"""          if (it.length) {
            // ⛔ 同样按 pushAll 返回值闭锁：被闸门拦下就别把"今天已发"打上
            if (pushAll(buildReviewMessage(), true) !== false) {
              reviewSentDate = todayStr();
              console.log('[复盘] 重启补发完成 items=' + it.length);
            } else console.log('[复盘] 重启补发被闸门拦下，保留重试机会');
          }""",
    u"""          if (it.length) {
            // ⛔ 同样按 pushAll 返回值闭锁：被闸门拦下就别把"今天已发"打上
            if (pushAll(buildReviewMessage(), true) !== false) {
              reviewSentDate = todayStr();
              remedyDone('reviewBoot', { ok: true }, it.length);   // dw：补发成功要登记，remedyState 才分得清「成了」还是「没跑」
              console.log('[复盘] 重启补发完成 items=' + it.length);
            } else { remedyDone('reviewBoot', { ok: false, error: '被闸门拦下' }, 0); console.log('[复盘] 重启补发被闸门拦下，保留重试机会'); }
          } else {
            // ⛔ dw：复盘算出 0 条 ≠ 没算。跑完了但 0 条，要留痕告警（数据源没回来 or 今天真没涨停）
            remedyDone('reviewBoot', { ok: true }, 0);
          }""",
    '② 复盘补发登记成功/0条')

# ── ③ _bootSeed catch 登记失败 ──
rep(SRV,
    u"""        remedyDone('bootSeed', { ok: true }, (r && r.added) || 0);
      } else remedySkip('bootSeed', 'bootSeedEnough');
    } catch (e) { console.error('[learn] 启动补样本失败:', e && e.message); }""",
    u"""        remedyDone('bootSeed', { ok: true }, (r && r.added) || 0);
      } else remedySkip('bootSeed', 'bootSeedEnough');
      // ⛔ dw：seedLearnFromHistory 抛异常时上面的 remedyDone 根本没执行 —— catch 只 console.error，
      //    补救状态里就永远看不到「启动补样本失败过」这回事。现在把异常也登记进补救台账。
    } catch (e) { console.error('[learn] 启动补样本失败:', e && e.message); remedyDone('bootSeed', { ok: false, error: e && e.message }, 0); }""",
    '③ 启动补样本异常登记')

# ── ④ 前端读 bad ──
rep(HTML,
    u"""  const rm = s.remedy || {};
  const bad = Object.keys(rm).filter(k => rm[k] && (rm[k].ok === false || rm[k].why === 'zero' || rm[k].why === 'busy' || rm[k].why === 'err'));""",
    u"""  const rm = s.remedy || {};
  // ⛔ dw：补救失败的服务端判据统一由 remedyBadOf 产出（bad 字段）—— 前端别自己再拼 ok/why 过滤，
  //    否则「数据缺口跳过卡到机会用尽」这类（ok=null 但确实没补上）会被漏掉。
  const bad = Object.keys(rm).filter(k => rm[k] && rm[k].bad);""",
    '④ 前端读 bad')

print('\n==== FAILS: %d ====' % len(FAILS))
sys.exit(1 if FAILS else 0)
