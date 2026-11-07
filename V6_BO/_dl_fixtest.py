# -*- coding: utf-8 -*-
# dl 轮：三份守门测试被"钉死的旧字面量"卡住（不是实现错了，是断言钉了字符串/字符窗口）。
# 按既定规矩：⛔ 改判据、不改实现 —— 且新判据要钉语义，不要再钉字符数。
import io, sys

def edit(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new, tag in pairs:
        if s.count(old) != 1:
            print('FAIL[%s] %s count=%d' % (path, tag, s.count(old))); sys.exit(1)
        s = s.replace(old, new, 1)
        print('OK  %s :: %s' % (path, tag))
    io.open(path, 'w', encoding='utf-8', newline='').write(s)

# ── 1) _test_fail.js：前端把失败原因挂 title ──
edit('_test_fail.js', [(
    u"""  ok('前端把失败原因挂在 title 上（不是只写「失败」）',
    /ts\\[k\\]\\.error/.test(script) && /cursor:help/.test(script));""",
    u"""  // ⛔ dl 轮改判据：原来钉的是 `ts[k].error` 这串字符，renderTaskState 重写后就假红了。
  //    钉语义：失败/0条的原因必须被拼进 title，且带 cursor:help（悬浮才看得到）。
  ok('前端把失败原因挂在 title 上（不是只写「失败」）',
    /v\\.empty \\|\\| v\\.error/.test(script) && /cursor:help/.test(script) && /title=/.test(script));""",
    'fail.js 钉语义')])

# ── 2) _test_gov_atomic.js：任一通道送到就不退占位 ──
edit('_test_gov_atomic.js', [(
    u"""  ok('⛔ 任一通道送到就不退占位（避免邮箱收到两份）',
    /if \\(_fsOk \\|\\| _mailOk\\) return;/.test(blk) && /if \\(_fsOk === null \\|\\| _mailOk === null\\) return;/.test(blk));""",
    u"""  // ⛔ dl 轮改判据：原来钉 `if (_fsOk || _mailOk) return;` 整行字面量，
  //    该分支现在顺带记一条 _pushLast（语义未变：仍然是不回滚直接返回）→ 旧断言假红。
  //    钉语义：_release 必须出现在「任一通道送到」分支【之后】，且该分支里有 return。
  {
    const sm = blk.match(/const _settle = \\(\\) => \\{([\\s\\S]*?)\\n {2}\\};/);
    const sb = sm ? sm[1] : '';
    const p1 = sb.indexOf('_fsOk || _mailOk'), p2 = sb.indexOf('_release');
    ok('⛔ 任一通道送到就不退占位（避免邮箱收到两份）',
      p1 >= 0 && p2 > p1 && /return/.test(sb.slice(p1, p2)) &&
      /if \\(_fsOk === null \\|\\| _mailOk === null\\) return;/.test(blk));
  }""",
    'gov_atomic 钉语义')])

# ── 3) _test_rollback.js：同一条断言 ──
edit('_test_rollback.js', [(
    u"""    ok('任一通道送到就不回滚', /if \\(_fsOk \\|\\| _mailOk\\) return;/.test(seg));""",
    u"""    // ⛔ dl 轮改判据：钉语义（_release 必须排在「任一通道送到」之后，该分支里有 return），
    //    不再钉 `if (_fsOk || _mailOk) return;` 的字面量 —— 该分支现在多记一条 _pushLast。
    {
      const p1 = seg.indexOf('_fsOk || _mailOk'), p2 = seg.indexOf('_release');
      ok('任一通道送到就不回滚', p1 >= 0 && p2 > p1 && /return/.test(seg.slice(p1, p2)));
    }""",
    'rollback 钉语义')])

# ── 4) _test_return_contract.js：副本拦截 / 未配置通道 → true ──
#    原断言钉了 {0,600} / {0,200} 的字符窗口，dl 轮在 return true 前插了 _pushLast 行 → 撑爆窗口假红。
edit('_test_return_contract.js', [(
    u"""ok('副本拦截 → true（副本永不外发，返回 false 会让本地每 20 秒重跑复盘烧数据源）',
  /if \\(isReplica\\(\\) &&[\\s\\S]{0,600}?return true;[\\s\\S]{0,80}?\\}/.test(src));
ok('未配置通道 → true（配置问题，重试一万次也发不出去）',
  /if \\(!feishuReady\\(\\) &&[\\s\\S]{0,200}?return true;/.test(src));""",
    u"""// ⛔ dl 轮改判据：原来钉 {0,600} / {0,200} 的字符窗口，本轮在这两处 return true 之前
//    各插了一行 _pushLast（登记「返回 true 但没送达」），窗口被撑爆 → 假红。
//    钉语义：整段 if 分支里只能有 return true，不许有 return false。
const _pb = src.slice(src.indexOf('function pushAll(text, force, opts) {'));
const _branch = anchor => {
  const i = _pb.indexOf(anchor);
  if (i < 0) return '';
  return _pb.slice(i, _pb.indexOf('\\n  }', i));
};
{
  const b1 = _branch('if (isReplica()');
  ok('副本拦截 → true（副本永不外发，返回 false 会让本地每 20 秒重跑复盘烧数据源）',
    b1.length > 0 && /return true;/.test(b1) && !/return false;/.test(b1));
  const b2 = _branch('if (!feishuReady()');
  ok('未配置通道 → true（配置问题，重试一万次也发不出去）',
    b2.length > 0 && /return true;/.test(b2) && !/return false;/.test(b2));
}""",
    'return_contract 钉语义')])
print('all done')
