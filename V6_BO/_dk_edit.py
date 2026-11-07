# dk 轮改码：同一个「失败」在系统里必须有同一套说法
import io, sys

def rw(p, fn):
    s = io.open(p, encoding='utf-8').read()
    s2 = fn(s)
    if s2 is None:
        print('失败:', p); sys.exit(1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))

def rep(s, old, new, cnt=1, tag=''):
    if s.count(old) != cnt:
        print('  !! %s 锚点命中 %d 次（应 %d）: %r' % (tag, s.count(old), cnt, old[:70])); sys.exit(1)
    return s.replace(old, new, cnt)

BLOCK = u'''// ─── 「失败」的说法登记表（2026-10-07 dk 轮）────────────────────────────
// 同一个「这一轮没跑成」，在系统里实测有 5 种说法，各模块各挑一种：
//   有的写 {ok:false, error}（面板显示"本轮没跑成"）、有的 return null（调用方当"没数据"）、
//   有的 console.error 后继续（面板照样显示上一次成功的数据，看起来刚跑完）、
//   有的 pushLog('❌…')（只有推送流水里看得到）、还有 174 处干脆空 catch 静默。
// 实测的不对称：三个周期任务（涨停前形态 / 全市场趋势扫描 / K线回填）早就有本轮状态
//   （cu 轮「只在 happy path 上定义过的状态」修的），而**大单流入 / 启动前埋伏 / 相似跟随 /
//   连续收涨 / 学习入库**这几个一个都没有 —— 同一类事件在这头看得见、在那头毫无痕迹，
//   面板一律显示上一次成功的数据，用户没法判断"这是没跑，还是跑砸了"。
// 现在按场景登记该用哪种说法；周期任务一律走 taskSet 唯一出口，面板统一提示。
const FAIL_RULE = {
  task:    { how: 'state',  note: '周期任务（扫描 / 入库）→ 必须写本轮状态 taskSet(ok/error)，面板显示「这一轮没跑成」' },
  fetch:   { how: 'null',   note: '单只票取数 → 返回 null，调用方按「没取到」处理；⛔ 不许空 catch 静默（那会让调用方以为"真的没有"）' },
  persist: { how: 'log',    note: '落盘失败 → console.error + 撤回内存改动；⛔ 空 catch 会让数据真的没了且不留痕' },
  async:   { how: 'push',   note: '异步重活失败 → pushLog(❌…)，用户侧在推送流水里看得见' },
  bypass:  { how: 'silent', note: '纯装饰性旁路（题材补拉等，缺了照样能跑）→ 允许静默，但必须显式登记在这一类' }
};
const failHow = k => { const d = FAIL_RULE[k]; return d ? d.how : ''; };
// 哪些周期任务必须有「本轮跑没跑成」的状态（面板据此提示，而不是默默显示上一次的旧数据）
const TASK_RULE = {
  ztpre: '涨停前形态扫描', trendScan: '全市场趋势扫描', steadyUp: '连续收涨',
  bigmoney: '大单流入', similar: '相似走势跟随', pre: '启动前埋伏',
  learnall: '学习库入库', ztpreIngest: '涨停前入库', kbf: 'K线回填'
};
const _taskState = {};
function taskSet(name, patch) {
  if (!TASK_RULE[name]) { console.error('[task] 未登记的任务名: ' + name); return; }
  const cur = _taskState[name] || { ok: null, error: '', n: 0, ms: 0, t: 0 };
  _taskState[name] = Object.assign({}, cur, patch, { t: Date.now() });
}
function taskState() {
  const o = {};
  for (const k of Object.keys(TASK_RULE)) {
    const v = _taskState[k] || { ok: null, error: '', n: 0, ms: 0, t: 0 };
    o[k] = { name: TASK_RULE[k], ok: v.ok, error: v.error, n: v.n, ms: v.ms, t: v.t };
  }
  return o;
}
let _rollbackMsg = null;'''

def f1(s):
    return rep(s, u'let _rollbackMsg = null;', BLOCK, 1, 'BLOCK')

rw('server.js', f1)

def f2(s):
    # ① 大单流入：包装器补成功/失败状态
    s = rep(s, u"  try { _bmTs = Date.now(); return await scanBigMoneyInner(); }\n  finally { _bmBusy = false; }",
               u"  try {\n"
               u"    _bmTs = Date.now();\n"
               u"    const _r = await scanBigMoneyInner();\n"
               u"    taskSet('bigmoney', { ok: true, error: '', n: ((S.bigMoney || {}).items || []).length });\n"
               u"    return _r;\n"
               u"  } catch (e) {\n"
               u"    // ⛔ 原来这里只有 finally：失败时面板照样显示上一次成功的大单列表，\n"
               u"    //    看起来刚跑完，实际那批数据是几分钟前甚至上一轮休市前的。\n"
               u"    taskSet('bigmoney', { ok: false, error: String((e && e.message) || e || '未知异常') });\n"
               u"    console.error('[bigmoney] 扫描失败:', e && e.message);\n"
               u"    return S.bigMoney.items || [];\n"
               u"  } finally { _bmBusy = false; }", 1, 'bigmoney')
    # ② 启动前埋伏：同上
    s = rep(s, u"  try { _preTs = Date.now(); return await preBreakoutInner(); }\n  finally { _preBusy = false; }",
               u"  try {\n"
               u"    _preTs = Date.now();\n"
               u"    const _r = await preBreakoutInner();\n"
               u"    taskSet('pre', { ok: true, error: '', n: ((S.pre || {}).items || []).length });\n"
               u"    return _r;\n"
               u"  } catch (e) {\n"
               u"    taskSet('pre', { ok: false, error: String((e && e.message) || e || '未知异常') });\n"
               u"    console.error('[pre] 埋伏扫描失败:', e && e.message);\n"
               u"    return S.pre.items || [];\n"
               u"  } finally { _preBusy = false; }", 1, 'pre')
    # ③ 相似跟随：catch 里补状态，成功处补状态
    s = rep(s, u"    S.similar = { time: new Date().toLocaleTimeString('zh-CN'), items: list };",
               u"    S.similar = { time: new Date().toLocaleTimeString('zh-CN'), items: list };\n"
               u"    taskSet('similar', { ok: true, error: '', n: list.length });", 1, 'similar-ok')
    s = rep(s, u"  } catch (e) { console.error('[similar]', e && e.message); }\n}",
               u"  } catch (e) {\n"
               u"    taskSet('similar', { ok: false, error: String((e && e.message) || e || '未知异常') });\n"
               u"    console.error('[similar]', e && e.message);\n"
               u"  }\n}", 1, 'similar-catch')
    # ④ 连续收涨：成功出口补状态
    s = rep(s, u"  S.steadyUpBasis = basisOf(_bd, _bTot, _expDay);   // 基准日：同上，连涨形态算到哪天为止\n  return { ok: true, total: out.length, items: S.steadyUp };",
               u"  S.steadyUpBasis = basisOf(_bd, _bTot, _expDay);   // 基准日：同上，连涨形态算到哪天为止\n"
               u"  taskSet('steadyUp', { ok: true, error: '', n: out.length });\n"
               u"  return { ok: true, total: out.length, items: S.steadyUp };", 1, 'steadyUp')
    # ⑤ /api/state 下发
    s = rep(s, u"      winRule: winRuleState(),",
               u"      winRule: winRuleState(),\n      taskState: taskState(),", 1, 'state')
    return s

rw('server.js', f2)
print('全部完成')
