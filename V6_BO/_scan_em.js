/**
 * em 轮扫描：竞价期间接近涨停检测 + 全市场刷新间隔
 * 对应第112项任务：修复价格更新不及时和竞价涨停检测
 */
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
// 简单去注释（不去字符串），用于找函数体
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let errs = 0;
function ok(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.log('  ❌ ' + msg); errs++; }

console.log('═ em 轮：竞价期间接近涨停检测 + 全市场刷新 ═');

// ① S 初始化中必须有 auctionNearZTNotified
if (/auctionNearZTNotified\s*:\s*new\s+Set\(\)/.test(SV)) ok('S 初始化包含 auctionNearZTNotified: new Set()');
else fail('S 初始化缺少 auctionNearZTNotified');

// ② 全市场刷新间隔必须是 2 分钟
if (/setInterval\(guard\('allStocks'[\s\S]{0,400}\)\s*,\s*2\s*\*\s*60\s*\*\s*1000\s*\)/.test(SV)) ok('全市场刷新间隔 = 2分钟');
else fail('全市场刷新间隔不是 2分钟');

// ③ tick() 中必须有竞价期间检测逻辑
const tickMatch = SRC.match(/function\s+tick\s*\(\)\s*\{/);
if (!tickMatch) { fail('找不到 tick() 函数'); process.exit(1); }

// 找到 tick 函数体（用括号配对）
let depth = 0, tickStart = -1, tickEnd = -1, inTick = false;
for (let i = 0; i < SRC.length; i++) {
  if (SRC.slice(i, i + tickMatch[0].length) === tickMatch[0] && !inTick) {
    inTick = true;
    tickStart = i + tickMatch[0].length;
    depth = 1;
    i = tickStart - 1;
    continue;
  }
  if (!inTick) continue;
  if (SRC[i] === '{') depth++;
  if (SRC[i] === '}') { depth--; if (depth === 0) { tickEnd = i; break; } }
}
if (tickStart < 0 || tickEnd < 0) { fail('无法定位 tick() 函数体'); process.exit(1); }
const tickBody = SRC.slice(tickStart, tickEnd);

// ④ tick() 内必须有 auctionPhase 调用
if (/auctionPhase\s*\(\s*new\s+Date\s*\(\s*\)\s*\)/.test(tickBody)) ok('tick() 内调用 auctionPhase(new Date())');
else fail('tick() 内缺少 auctionPhase(new Date()) 调用');

// ⑤ tick() 内必须有 _aph === 1 || _aph === 2 判断
if (/\b_aph\s*===?\s*1\b/.test(tickBody) && /\b_aph\s*===?\s*2\b/.test(tickBody)) ok('tick() 内判断竞价时段 phase 1/2');
else fail('tick() 内缺少竞价时段 phase 1/2 判断');

// ⑥ tick() 内必须有跨日清空逻辑
if (/_auctionNearZTDs\s*!==?\s*_ds/.test(tickBody)) ok('tick() 内有跨日清空 auctionNearZTNotified 逻辑');
else fail('tick() 内缺少跨日清空逻辑');

// ⑦ tick() 内必须有 gap > 0.5 && gap < 2 判断
if (/gap\s*>\s*0\.5\s*&&\s*gap\s*<\s*2/.test(tickBody)) ok('tick() 内距涨停范围判断 0.5%~2%');
else fail('tick() 内缺少距涨停范围判断');

// ⑧ tick() 内必须有市值门槛
if (/35/.test(tickBody) && /_capYi/.test(tickBody)) ok('tick() 内有市值门槛逻辑');
else fail('tick() 内缺少市值门槛逻辑');

// ⑨ tick() 内必须有每轮最多3只限制
if (/slice\s*\(\s*0\s*,\s*3\s*\)/.test(tickBody)) ok('tick() 内每轮最多3只限制');
else fail('tick() 内缺少每轮最多3只限制');

// ⑩ tick() 内必须有 S.auctionNearZTNotified.add
if (/auctionNearZTNotified\.add\s*\(/.test(tickBody)) ok('tick() 内有推送去重 add()');
else fail('tick() 内缺少推送去重 add()');

// ⑪ tick() 内必须有 pushAll(msg) 调用
if (/pushAll\s*\(\s*msg\s*\)/.test(tickBody)) ok('tick() 内调用 pushAll(msg)');
else fail('tick() 内缺少 pushAll(msg) 调用');

// ⑫ 全市场刷新注释中必须提到「2分钟」或「价格更新不及时」
const allStocksIdx = SV.indexOf("guard('allStocks'");
let allStocksCommentOk = false;
if (allStocksIdx >= 0) {
  const ctx = SV.slice(Math.max(0, allStocksIdx - 300), allStocksIdx + 500);
  if (/2\s*分钟|价格更新不及时|第112项/.test(ctx)) allStocksCommentOk = true;
}
if (allStocksCommentOk) ok('全市场刷新代码附近有任务注释');
else fail('全市场刷新代码附近缺少任务注释');

// ⑬ S.stocks 注释应更新为「每2分钟」（原来是「每3分钟」）
if (/stocks:\s*\[\]\s*,\s*\/\/\s*全A快照\s*\(每2分钟全量刷新\)/.test(SV)) ok('S.stocks 注释已更新为每2分钟');
else if (/stocks:\s*\[\]\s*,\s*\/\/\s*全A快照\s*\(每3分钟全量刷新\)/.test(SV)) fail('S.stocks 注释仍是每3分钟，请更新');
else ok('S.stocks 注释（未匹配到明确分钟数，略过）');

console.log(`\n═ 结果：${errs} 个问题 ═`);
process.exit(errs > 0 ? 1 : 0);
