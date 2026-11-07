# -*- coding: utf-8 -*-
"""dg 轮：同一个键的默认值 / 越界兜底，在所有入口下收成一份"""
import io, re, sys

P = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\server.js"
src = io.open(P, encoding='utf-8').read()
lines = src.split('\n')
orig_len = len(lines)


def find_line(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    return -1


def brace_match(start):
    """从含 '{' 的 start 行起，括号配平返回结束行号"""
    depth = 0
    for i in range(start, len(lines)):
        depth += lines[i].count('{') - lines[i].count('}')
        if depth == 0 and i >= start:
            return i
    return -1


# ── E1 删除旧的 _govCfg 定义块（连同上面两行注释）──────────────────────────
i = find_line(lambda l: l.startswith('const _govCfg = (k, def) => {'))
assert i > 0, 'E1 找不到 _govCfg'
j = brace_match(i)
assert lines[j].strip() == '};', 'E1 闭合行异常: ' + lines[j]
# 往前吃掉紧邻的注释行
k = i - 1
while k >= 0 and lines[k].lstrip().startswith('//'):
    k -= 1
del lines[k + 1:j + 1]
print('E1 删除旧 _govCfg 块，行 %d~%d' % (k + 2, j + 1))

# ── E2 删除旧的 CFG_RANGE + cfgRangeErrors 块 ──────────────────────────────
i = find_line(lambda l: l.startswith('// ── 配置项取值域表'))
assert i > 0, 'E2 找不到 CFG_RANGE 注释头'
k = find_line(lambda l: l.startswith('function cfgRangeErrors('))
assert k > 0, 'E2 找不到 cfgRangeErrors'
j = brace_match(k)
assert lines[j].strip() == '}', 'E2 闭合行异常: ' + lines[j]
del lines[i:j + 1]
print('E2 删除旧 CFG_RANGE 块，行 %d~%d' % (i + 1, j + 1))

# ── E3 在 let _rollbackMsg = null; 之前插入新块 ────────────────────────────
NEW = u"""// ── 配置项取值域表（2026-10-06 bn 轮新增；2026-10-07 dg 轮补 def + 读取端上界）────
// 背景：/api/config 以前对数值键只有一个 `>= 0` 的下界，**没有上界、也不分百分数与比例**。
//   而这些键的量纲并不一致 —— probThreshold 是 0~1 的**比例**，
//   pushMinProb / bigMoneyProbGate / simGate / bigMoneyPct / activePctThreshold 是 0~100 的**百分数**。
//   同一个接口里两种量纲混着却没校验，填错一格就是**静默失效**：
//     · probThreshold 填 82（按百分数的习惯）→ 判定式 `useProb < 82` 对 0~100 的概率恒成立
//       → 趋势/精选池推送永久静默，面板照常显示、日志一行不报；
//     · pushMinProb 填 200 → 主闸门永远拦下 → 全天一条都推不出去；
//     · bigMoneyPct 填 500 → 大单模块永久 0 输出。
//   更隐蔽的是 `Number('') === 0`：清空输入框提交空串会被当成「设 0 = 完全不限」，
//   与用户"清空/不改"的意图正好相反。
// ⛔⛔ dg 轮补 def（本轮角度：同一个开关在不同入口下的默认值是不是同一个）：
//   默认值以前**散在 15 个调用点的第二个参数里**（`_govCfg('simGate', 62)` 六处各写一遍 62），
//   而 probThreshold 又是第三种写法 —— S.config 初始对象里躺着一个 0.80，
//   系统自己在口径回滚段、CFG_RANGE 的 hint、线上 config.json 里认定的却都是 0.82：
//   **同一个"概率推送线"，四处里三处是 82%、初始对象是 80%，全新实例会按 80% 跑**，
//   而且面板会把这个数印出来（「概率推送线 80%」），没人知道它本该是 82%。
//   现在 def 与 min/max 同在一张表里，调用点一律 `_govCfg(k)`，不许再带第二份默认值。
const CFG_RANGE = {
  probThreshold:      { def: 0.82, min: 0, max: 1,           hint: '0~1 的比例（0.82 = 82%，不是 82）' },
  pushMinProb:        { def: 55,   min: 0, max: 100,         hint: '百分数 0~100（0 = 不限）' },
  pushMinProbPre:     { def: 45,   min: 0, max: 100,         hint: '百分数 0~100（0 = 不限）' },
  bigMoneyProbGate:   { def: 50,   min: 0, max: 100,         hint: '百分数 0~100' },
  simGate:            { def: 62,   min: 0, max: 100,         hint: '相似度 0~100' },
  bigMoneyPct:        { def: 6,    min: 0, max: 100,         hint: '百分数 0~100' },
  activePctThreshold: { def: 6,    min: 0, max: 100,         hint: '百分数 0~100' },
  pushMaxPerDay:      { def: 350,  min: 0, max: 2000,        hint: '条/天（0 = 不限）' },
  pushDailyMsgs:      { def: 8,    min: 0, max: 200,         hint: '条/天（0 = 不限）' },
  pushMaxPerCode:     { def: 2,    min: 0, max: 100,         hint: '次/天（0 = 不限）' },
  pushCooldownMin:    { def: 90,   min: 0, max: 7 * 24 * 60, hint: '分钟（0 = 不冷却）' }
};
// 返回人类可读的错误列表；空数组 = 全部合法。
function cfgRangeErrors(inObj) {
  const bad = [];
  for (const k of Object.keys(inObj || {})) {
    const r = CFG_RANGE[k];
    if (!r) { bad.push(`${k}：不在白名单里（可调的键：${Object.keys(CFG_RANGE).join('/')}）`); continue; }
    const raw = inObj[k];
    // ⛔ 空串必须先挡：Number('') === 0 会被当成「设 0 = 完全不限」，与"清空"的意图相反
    if (raw === '' || (typeof raw === 'string' && raw.trim() === '')) { bad.push(`${k}：不能为空（想「不限」请显式填 0，不想改就不要提交这个键）`); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { bad.push(`${k}：不是有效数字（收到 ${JSON.stringify(raw)}）`); continue; }
    // 量纲提示：把 82 当成 82% 填进 0~1 的比例键，是最容易犯也最难自查的一种
    if (k === 'probThreshold' && n > 1 && n <= 100) {
      bad.push(`${k}：收到 ${n}，看着像百分数；这个键用的是 0~1 的比例，${n}% 应填 ${(n / 100).toFixed(2)}`);
      continue;
    }
    if (n < r.min || n > r.max) bad.push(`${k}：超出允许范围 ${r.min}~${r.max}（${r.hint}），收到 ${n}`);
  }
  return bad;
}
// ⚠️ 不能用 `+(x) || 默认`：0 是假值 —— 把冷却设成 0（想关掉冷却）会被静默吞成 90，
//    测试里"换模块放行"一直失败才暴露出来。统一走这个取值器。
// ⛔ dg 轮两条补充：
//   ① 默认值只认 CFG_RANGE[k].def（调用点不许再带第二份 —— 那正是"同一个开关两个默认"的根源）；
//   ② **上界也要在读取端兜住** —— cfgSetOf（开关类那张表）早就这么做了：config.json 是
//      手改得动的文件，里面躺着 200 时不能让它真生效；而数值键这边是同一条道理下的漏网之鱼：
//      写入端 cfgRangeErrors 只体检【新提交】的值，**手改过的 config.json、老版本遗留的旧值
//      从来没被兜过** → pushMinProb=200 从面板提交会被拦下，从文件里读出来却照样全天零推送。
const _govCfg = k => {
  const d = CFG_RANGE[k];
  const v = S.config ? S.config[k] : undefined;
  const n = Number(v);
  if (!d) return Number.isFinite(n) && n >= 0 ? n : 0;      // 未登记的键：沿用旧行为，不改动语义
  return Number.isFinite(n) && n >= d.min && n <= d.max ? n : d.def;
};
// 「概率推送线」唯一读取口（量纲是 0~1 的比例，与上面那些 0~100 的百分数键不是一回事）：
//   以前四处**裸读** S.config.probThreshold —— 键被删了或值坏了就是 undefined，
//   `* 100` 之后变 NaN，判定式 `probC > NaN` 恒 false → 整个模块永久静默，日志一行不报；
//   另一处 `(S.config && S.config.probThreshold) || null` 又把**合法的 0**（= 不限，CFG_RANGE
//   明写下界就是 0）静默吞成 null —— 同一个键的"空值 / 零值"在两个入口下结论正好相反。
const probThreshold = () => _govCfg('probThreshold');
// 面板要显示「现在是多少 / 默认是多少 / 有没有越界」，三样都由兑现方产出（de 轮原则）：
//   用户把 pushMinProb 改成 200 之后想改回来，以前面板上没有任何一处写着"默认 55"。
function cfgRangeState() {
  const out = {};
  for (const k of Object.keys(CFG_RANGE)) {
    const d = CFG_RANGE[k];
    const v = S.config ? S.config[k] : undefined;
    const n = Number(v);
    const ok = Number.isFinite(n) && n >= d.min && n <= d.max;
    out[k] = {
      cur: ok ? n : null,                       // 磁盘上真实存着的值（越界/坏了就是 null）
      def: d.def, min: d.min, max: d.max, hint: d.hint,
      using: _govCfg(k),                        // 实际生效的值
      bad: ok ? '' : (v === undefined ? 'unset' : 'bad')
    };
  }
  return out;
}"""

i = find_line(lambda l: l.startswith('let _rollbackMsg = null;'))
assert i > 0, 'E3 找不到 _rollbackMsg'
lines.insert(i, NEW)
print('E3 在第 %d 行前插入配置表新块（%d 行）' % (i + 1, NEW.count('\n') + 1))

src = '\n'.join(lines)

# ── E4 回滚段：默认值改用表，不再写死 ──────────────────────────────────────
old_rb = u"""    if (+(S.config.probThreshold || 0) > 0.86) { _rb.push(`推送阈值 ${Math.round(S.config.probThreshold * 100)}%→82%`); S.config.probThreshold = 0.82; }
    if (_govCfg('bigMoneyProbGate', 50) > 60) { _rb.push(`大单门槛 ${S.config.bigMoneyProbGate}%→50%`); S.config.bigMoneyProbGate = 50; }
    if (_govCfg('simGate', 62) > 65) { _rb.push(`相似度门槛 ${S.config.simGate}→62`); S.config.simGate = 62; }"""
new_rb = u"""    // ⛔ 回滚目标一律取 CFG_RANGE.def：以前这里写死 0.82 / 50 / 62，而默认值其实还有另外两份
    //    （S.config 初始对象的 0.80、15 个调用点的第二参数）—— 同一个"默认值"三处各写一遍，
    //    改一处漏两处就是"新实例 80%、老实例 82%"这种没人看得出来的分叉。
    if (probThreshold() > 0.86) { _rb.push(`推送阈值 ${Math.round(probThreshold() * 100)}%→${Math.round(CFG_RANGE.probThreshold.def * 100)}%`); S.config.probThreshold = CFG_RANGE.probThreshold.def; }
    if (_govCfg('bigMoneyProbGate') > 60) { _rb.push(`大单门槛 ${_govCfg('bigMoneyProbGate')}%→${CFG_RANGE.bigMoneyProbGate.def}`); S.config.bigMoneyProbGate = CFG_RANGE.bigMoneyProbGate.def; }
    if (_govCfg('simGate') > 65) { _rb.push(`相似度门槛 ${_govCfg('simGate')}→${CFG_RANGE.simGate.def}`); S.config.simGate = CFG_RANGE.simGate.def; }"""
assert old_rb in src, 'E4 找不到回滚段原文'
src = src.replace(old_rb, new_rb)
print('E4 回滚段改为读表')

# ── E5 15 个 _govCfg 调用点去掉第二参数 ────────────────────────────────────
n5 = len(re.findall(r"_govCfg\('([\w$]+)',\s*[\d.]+\)", src))
src = re.sub(r"_govCfg\('([\w$]+)',\s*[\d.]+\)", r"_govCfg('\1')", src)
print('E5 去掉 _govCfg 第二参数：%d 处' % n5)

# ── E6 probThreshold 读取点收口 ────────────────────────────────────────────
reps = [
    (u"config: { feishuWebhook: '', feishuSecret: '', probThreshold: 0.80, qqMail: { user: '', authCode: '', to: '' } },",
     u"// ⛔ probThreshold 故意不写在这里：它和另外 10 个数值键一样，默认值只在 CFG_RANGE.def 里有一份。\n  config: { feishuWebhook: '', feishuSecret: '', qqMail: { user: '', authCode: '', to: '' } },"),
    (u"  const cur = S.config.probThreshold;",
     u"  const cur = probThreshold();"),
    (u"        const pushTh = S.config.probThreshold * 100 * (goodHit ? 0.88 : badHit ? 1.15 : 1);",
     u"        const pushTh = probThreshold() * 100 * (goodHit ? 0.88 : badHit ? 1.15 : 1);"),
    (u"        probThreshold: (S.config && S.config.probThreshold) || null,",
     u"        probThreshold: probThreshold(),"),
    (u"      probThreshold: S.config.probThreshold,",
     u"      probThreshold: probThreshold(),"),
    (u"config: { wecomReady: feishuReady(), probThreshold: S.config.probThreshold, mailReady: mailReady(),",
     u"config: { wecomReady: feishuReady(), probThreshold: probThreshold(), mailReady: mailReady(),"),
]
for a, b in reps:
    assert a in src, 'E6 找不到：' + a[:60]
    src = src.replace(a, b)
print('E6 probThreshold 读取点收口：%d 处' % len(reps))

# ── E7 /api/state 下发 cfgRange ───────────────────────────────────────────
a = u"      cfgSet: cfgSetState(),"
assert a in src, 'E7 找不到 cfgSet'
src = src.replace(a, u"      cfgSet: cfgSetState(),\n      cfgRange: cfgRangeState(),")
print('E7 /api/state 下发 cfgRange')

io.open(P, 'w', encoding='utf-8', newline='\n').write(src)
print('写入完成：%d 行 → %d 行' % (orig_len, src.count('\n') + 1))
