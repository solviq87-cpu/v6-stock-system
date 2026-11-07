# dk 轮：把已有的 3 个进度状态对象并入 taskSet 统一出口
import io, sys

p = 'server.js'
s = io.open(p, encoding='utf-8').read()

def rep(old, new, cnt=1, tag=''):
    global s
    if s.count(old) != cnt:
        print('  !! %s 锚点命中 %d 次（应 %d）: %r' % (tag, s.count(old), cnt, old[:70])); sys.exit(1)
    s = s.replace(old, new, cnt)

# 涨停前形态：zpProgSet 是唯一写入口，转发一份给 taskSet
rep(u"function zpProgSet(patch) { _zpProg = Object.assign({}, _zpProg, patch, { t: Date.now() }); }",
    u"function zpProgSet(patch) {\n"
    u"  _zpProg = Object.assign({}, _zpProg, patch, { t: Date.now() });\n"
    u"  // 并入统一的「本轮跑没跑成」出口（dk 轮）：面板只看 taskState，不再每个模块各读一处\n"
    u"  taskSet('ztpre', { ok: !!_zpProg.ok, error: _zpProg.error || '', n: _zpProg.total || 0, ms: _zpProg.ms || 0 });\n"
    u"}", 1, 'zp')

# 全市场趋势扫描：tsProgSet 同理
rep(u"function tsProgSet(patch) { Object.assign(_tsProg, patch, { t: Date.now() }); }",
    u"function tsProgSet(patch) {\n"
    u"  Object.assign(_tsProg, patch, { t: Date.now() });\n"
    u"  taskSet('trendScan', { ok: !!_tsProg.ok, error: _tsProg.error || '', n: _tsProg.total || 0, ms: _tsProg.elapsedMs || 0 });\n"
    u"}", 1, 'ts')

# K线回填：直接赋值处补转发
rep(u"      _kbfProg.ok = false; _kbfProg.error = '票池为空（.universe_cache.json 没读到代码）';",
    u"      _kbfProg.ok = false; _kbfProg.error = '票池为空（.universe_cache.json 没读到代码）';\n"
    u"      taskSet('kbf', { ok: false, error: _kbfProg.error, n: 0 });", 1, 'kbf-bad')
rep(u"    _kbfProg.ok = true; _kbfProg.error = '';",
    u"    _kbfProg.ok = true; _kbfProg.error = '';\n"
    u"    taskSet('kbf', { ok: true, error: '', n: _kbfProg.added || 0, ms: _kbfProg.elapsedMs || 0 });", 1, 'kbf-ok')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK', p, '| CR=', io.open(p, encoding='utf-8').read().count('\r'))
