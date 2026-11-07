// 守门：竞价结束后 S.auction 不许被 captureAuction 反复重算（jb 轮，2026-10-20）
// 背景：用户反馈"盘中一直在变动，竞价明明结束了"——captureAuction 被启动链/手动刷新反复调用，
//   每次都拿最新全天累计成交额/最新涨跌幅重算 strong/score，导致竞价列表盘后还在漂移。
const fs = require('fs');
const srvSrc = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } }
function sec(name) { console.log('\n' + name); }

sec('① 源码存在竞价结束后冻结 guard');
ok(/const _nowPh = auctionPhase\(new Date\(\)\);/.test(srvSrc), 'captureAuction 顶部取当前 phase');
ok(/_nowPh === 0 && S\.auction && S\.auction\.date === _nowDay && Array\.isArray\(S\.auction\.strong\) && S\.auction\.strong\.length > 0/.test(srvSrc),
  'freeze 条件完整：phase=0 + 当前数据日已有 strong');
ok(/今日竞价已结束且数据已冻结，跳过重算/.test(srvSrc), 'freeze 日志文案存在');

sec('② 真跑：phase=0 + 今日有数据 → captureAuction 不覆盖 S.auction');
{
  const m = srvSrc.match(/async function captureAuction\(force\) \{[\s\S]*?\n\}/);
  ok(!!m, 'captureAuction 函数体可提取');
  if (m) {
    const S0 = { auction: { date: '20261020', strong: [{ code: '000001', score: 50 }], time: '09:25:00' } };
    const logs = [];
    const stubs = {
      console: { log: (...a) => logs.push(a.join(' ')) },
      Date: Date,
      auctionCaptureAllowed: () => true,
      auctionPhase: () => 0,
      todayStr: () => '20261020'
    };
    const fn = new Function('S', 'console', 'Date', 'auctionCaptureAllowed', 'auctionPhase', 'todayStr', `return (${m[0]});`);
    const captureAuction = fn(S0, stubs.console, stubs.Date, stubs.auctionCaptureAllowed, stubs.auctionPhase, stubs.todayStr);
    captureAuction(false);
    ok(S0.auction.strong.length === 1 && S0.auction.strong[0].code === '000001', 'S.auction.strong 未被覆盖');
    ok(logs.some(s => s.includes('今日竞价已结束且数据已冻结')), 'freeze 日志已打印');
  }
}

sec('③ 反证：phase=0 + 无数据时仍允许补算（不跳过）');
{
  const m = srvSrc.match(/async function captureAuction\(force\) \{[\s\S]*?\n\}/);
  if (m) {
    const S1 = { auction: null };
    const logs = [];
    const stubs = {
      console: { log: (...a) => logs.push(a.join(' ')) },
      Date: Date,
      auctionCaptureAllowed: () => true,
      auctionPhase: () => 0,
      todayStr: () => '20261020'
    };
    const fn = new Function('S', 'console', 'Date', 'auctionCaptureAllowed', 'auctionPhase', 'todayStr', `return (${m[0]});`);
    const captureAuction = fn(S1, stubs.console, stubs.Date, stubs.auctionCaptureAllowed, stubs.auctionPhase, stubs.todayStr);
    captureAuction(false);
    ok(!logs.some(s => s.includes('今日竞价已结束且数据已冻结')), '无数据时不应触发 freeze 日志（允许补算）');
  }
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
