// 守门：jn 轮「涨幅异动池」模块（2026-10-21）
// 近 3 个交易日累计涨幅临近或达到交易所异常波动披露阈值。
const fs = require('fs');
const srvSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');
const htmlSrc = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } }
function sec(t) { console.log('\n' + t); }

sec('① 后端 scanAbnormalMove 与 /api/abnormal-move 存在');
{
  ok(/async function scanAbnormalMove\(/.test(srvSrc), 'scanAbnormalMove 函数定义存在');
  ok(/function abMoveThreshold\(code\)/.test(srvSrc), 'abMoveThreshold 阈值函数存在');
  ok(/S\.abMove/.test(srvSrc), 'S.abMove 被写入');
  ok(/p === '\/api\/abnormal-move'/.test(srvSrc), '/api/abnormal-move 路由存在');
  ok(/await scanAbnormalMove\(\{ force, max \}\)/.test(srvSrc), '路由透传 force/max');
  ok(/RO_MODS.*'abmove'/.test(srvSrc), "abmove 在 /api/refresh 只读可刷列表");
  ok(/mod === 'abmove'/.test(srvSrc), "/api/refresh 处理 abmove 模块");
  ok(/guard\('abmove'/.test(srvSrc), "涨幅异动定时器使用 guard('abmove')");
}

sec('② 阈值口径');
{
  // 用 new Function 从源码抠出 abMoveThreshold 真跑
  const fnMatch = srvSrc.match(/function abMoveThreshold\(code\)\s*\{[\s\S]*?\n\}/);
  ok(!!fnMatch, '能提取 abMoveThreshold 函数体');
  if (fnMatch) {
    const abMoveThreshold = new Function('return ' + fnMatch[0])();
    ok(abMoveThreshold('600000') === 20, '主板 600000 阈值 20%');
    ok(abMoveThreshold('000001') === 20, '主板 000001 阈值 20%');
    ok(abMoveThreshold('300226') === 30, '创业板 300226 阈值 30%');
    ok(abMoveThreshold('301218') === 30, '创业板 301218 阈值 30%');
    ok(abMoveThreshold('688000') === 30, '科创板 688000 阈值 30%');
    ok(abMoveThreshold('920000') === 40, '北交所 920000 阈值 40%');
    ok(abMoveThreshold('430000') === 40, '北交所 430000 阈值 40%');
  }
}

sec('③ 前端 index.html 渲染');
{
  ok(/id="amTopBox"/.test(htmlSrc), '存在 amTopBox 已触发异动容器');
  ok(/id="amNearBox"/.test(htmlSrc), '存在 amNearBox 临近异动容器');
  ok(/id="amInfo"/.test(htmlSrc), '存在 amInfo 说明区');
  ok(/onclick="doRefresh\('abmove',this\)"/.test(htmlSrc), '刷新按钮绑定 abmove');
  ok(/s\.abMove/.test(htmlSrc), 'render 读取 s.abMove');
  ok(/status === 'top'/.test(htmlSrc), '前端按 status 分组渲染');
  ok(/abMoveToggle\('top'\)/.test(htmlSrc), '已触发异动分组可折叠');
  ok(/abMoveToggle\('near'\)/.test(htmlSrc), '临近异动分组可折叠');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
