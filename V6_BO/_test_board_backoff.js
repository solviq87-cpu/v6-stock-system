// 守门测试：板块成分股接口必须有限流退避（2026-10-06）
// 背景（线上实测）：补涨龙一轮拉 8 个板块、启动前埋伏 6 个、新闻十几个，每 8 分钟一轮。
//   东财一限流，这路**没有退避** → 照旧每轮猛打十几个请求 → IP 被封一整天 →
//   两个模块整天零输出（面板上补涨龙/启动前埋伏一整天是空的，日志满屏"成分股拉取失败"）。
//   竞价那路早有 EM_BACKOFF，唯独这路漏了 —— 同一个数据源，待遇必须一致。
// 本测试钉死三件事：①失败后退避并阶梯递增/封顶 ②退避期间直接快速失败、不打网络 ③成功即清零。
// 另钉死：退避期间补涨龙/启动前埋伏要退回缓存名单并打上 stale 标记（不能悄悄用旧数据不吭声）。
'use strict';
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const EM_SRC = fs.readFileSync('em.js', 'utf8');
const SRV = fs.readFileSync('server.js', 'utf8');

// ───────── 1. 抽取 em.js 里的退避逻辑，装进带假时钟的沙箱真跑一遍 ─────────
const bStart = EM_SRC.indexOf('const BOARD_BACKOFF');
ok(bStart > 0, 'em.js 里存在 BOARD_BACKOFF 退避状态');

// ⚠️ 必须锚定 **_Core**（2026-10-06 修）：fetchBoardStocks 现在只是一层 dedup 包装，
//    真正的退避逻辑搬到了 _fetchBoardStocksCore。继续抽包装层会得到一个只调 dedup 的
//    空壳 → 沙箱里 dedup 未定义 → ReferenceError 整段崩（看着像"退避坏了"）。
const fStart = EM_SRC.indexOf('async function _fetchBoardStocksCore', bStart);
ok(fStart > bStart, 'BOARD_BACKOFF 声明在 _fetchBoardStocksCore 之前（先有状态再用）');
ok(EM_SRC.includes('async function fetchBoardStocks(bkCode, num = 50) {\n  return dedup('),
  'fetchBoardStocks 是 dedup 包装层（并发只打一次网络，见 _test_dedup.js）');

// 取到该函数的结束（顶层函数，以行首 } 收尾）
const fEnd = EM_SRC.indexOf('\n}\n', fStart);
ok(fEnd > fStart, '能定位 _fetchBoardStocksCore 函数边界');
const snippet = EM_SRC.slice(bStart, fEnd + 3);

let now = 1000000;                       // 假时钟
const FakeDate = { now: () => now };
let netCalls = 0;                        // 打网络的次数
let netSucceed = false;                  // 网络是否"通"
const fakeGet = async () => { netCalls++; if (netSucceed) return { data: { diff: [{ f12: '000001', f14: '平安银行', f2: 11, f3: 1.2, f6: 1, f8: 1, f62: 1, f184: 1 }] } }; throw new Error('socket hang up'); };
const fakeCurl = async () => { netCalls++; return netSucceed ? { data: { diff: [{ f12: '000001', f14: '平安银行', f2: 11, f3: 1.2, f6: 1, f8: 1, f62: 1, f184: 1 }] } } : null; };
const noopLog = () => {};

const mod = new Function('get', 'curlGet', 'EM', 'console', 'Date',
  snippet + '\n; return { fetchBoardStocks: _fetchBoardStocksCore, BOARD_BACKOFF, boardBackoffLeft };'
)(fakeGet, fakeCurl, 'https://push2.eastmoney.com', { log: noopLog }, FakeDate);

(async () => {
  // ① 首次失败 → 退避 30s
  netSucceed = false;
  let threw = false;
  try { await mod.fetchBoardStocks('BK1200', 50); } catch (e) { threw = true; }
  ok(threw, '两条通道都失败时抛错（调用方据此走缓存兜底）');
  ok(mod.BOARD_BACKOFF.fail === 1, '失败计数 +1（实得 ' + mod.BOARD_BACKOFF.fail + '）');
  ok(Math.round((mod.BOARD_BACKOFF.until - now) / 1000) === 30, '第1次失败退避 30s（实得 ' + Math.round((mod.BOARD_BACKOFF.until - now) / 1000) + 's）');

  // ② 退避期间：不打网络，直接快速失败
  netCalls = 0;
  threw = false;
  try { await mod.fetchBoardStocks('BK1200', 50); } catch (e) { threw = true; }
  ok(threw, '退避期间仍然抛错（不让调用方误以为拿到数据）');
  ok(netCalls === 0, '退避期间**一次网络都不打**（实打 ' + netCalls + ' 次）—— 这正是"别把自己封一整天"的关键');
  ok(mod.BOARD_BACKOFF.fail === 1, '退避期间的快速失败不重复累加计数');

  // ③ 退避到期 → 恢复打网络；再失败 → 阶梯递增到 60s
  now += 31000;
  netCalls = 0;
  try { await mod.fetchBoardStocks('BK1200', 50); } catch (e) {}
  ok(netCalls === 2, '退避到期后恢复打网络（两条通道各 1 次，实得 ' + netCalls + '）');
  ok(Math.round((mod.BOARD_BACKOFF.until - now) / 1000) === 60, '第2次失败退避递增到 60s（实得 ' + Math.round((mod.BOARD_BACKOFF.until - now) / 1000) + 's）');

  // ④ 阶梯封顶 300s（连败 20 次也不会无限拉长）
  for (let i = 0; i < 20; i++) { now += 301000; try { await mod.fetchBoardStocks('BK1200', 50); } catch (e) {} }
  const gap = Math.round((mod.BOARD_BACKOFF.until - now) / 1000);
  ok(gap === 300, '连败多次后退避封顶 300s（实得 ' + gap + 's）');

  // ⑤ 成功 → 立刻清零，回到正常频率
  now += 301000;
  netSucceed = true;
  const r = await mod.fetchBoardStocks('BK1200', 50);
  ok(Array.isArray(r) && r.length === 1 && r[0].code === '000001', '成功时正常返回成分股并解析字段');
  ok(mod.BOARD_BACKOFF.fail === 0 && mod.BOARD_BACKOFF.until === 0, '成功后退避清零（fail=' + mod.BOARD_BACKOFF.fail + ', until=' + mod.BOARD_BACKOFF.until + '）');
  ok(mod.boardBackoffLeft() === 0, '成功后剩余退避时间为 0');

  // ───────── 2. 调用方必须有缓存兜底 + stale 标记 ─────────
  const buIdx = SRV.indexOf('async function computeBuZhang');
  const buBlk = SRV.slice(buIdx, SRV.indexOf('\n}\n', buIdx));
  ok(/S\.secStocks && S\.secStocks\.get\(c\.sec\)/.test(buBlk), '补涨龙：成分拉取失败时退回 S.secStocks 缓存名单');
  ok(/if \(list\.length\) \(S\.secStocks \|\| \(S\.secStocks = new Map\(\)\)\)\.set\(c\.sec,/.test(buBlk),
    '补涨龙：拉到名单必须回填 S.secStocks（否则退避期缓存是空的，兜底形同虚设）');
  ok(!/[^|(]\bS\.secStocks\.set\(/.test(buBlk.replace(/S\.secStocks \|\| \(S\.secStocks = new Map\(\)\)/g, '')),
    '补涨龙：回填必须走自愈写法（裸 S.secStocks.set 未初始化时报 TypeError，会被外层 catch 吞掉 → 整块产出 0 且无日志）');
  ok(/stale:\s*staleBoard \|\| undefined/.test(buBlk), '补涨龙：候选打上 stale 标记（脏数据必须可辨识）');
  ok(/成分名单为缓存/.test(buBlk), '补涨龙：reason 文案里写明名单来自缓存');

  const preIdx = SRV.indexOf('async function preBreakoutInner');
  const preBlk = SRV.slice(preIdx, SRV.indexOf('\n}\n', preIdx));
  ok(/S\.secStocks && S\.secStocks\.get\(c\.sec\)/.test(preBlk), '启动前埋伏：成分拉取失败时退回 S.secStocks 缓存名单');
  ok(/if \(list\.length\) \(S\.secStocks \|\| \(S\.secStocks = new Map\(\)\)\)\.set\(c\.sec,/.test(preBlk),
    '启动前埋伏：拉到名单必须回填 S.secStocks，且同样走自愈写法');
  ok(/stale:\s*staleBoard \|\| undefined/.test(preBlk), '启动前埋伏：候选打上 stale 标记');

  // ───────── 3. 反向证明：这些护栏真的缺不得 ─────────
  const noBackoff = snippet.replace(/if \(boardBackoffLeft\(\) > 0\)[\s\S]{0,120}?\n  \}/, '');
  ok(noBackoff !== snippet, '反向证明：删掉退避守门后代码确实变了（说明该守门真实存在、不是空转）');
  ok(!/boardBackoffLeft\(\) > 0/.test(noBackoff), '反向证明：删掉后退避检查消失 → 若回归到此版本，退避即为失效');

  console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
  process.exit(fail ? 1 : 0);
})();
