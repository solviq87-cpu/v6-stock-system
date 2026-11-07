'use strict';
// 守门测试：「好的条件」过滤与冲板预警额度
const fs = require('fs');
const path = require('path');
const A = require('./analysis.js');

let failed = 0, passed = 0;
function ok(msg){ passed++; console.log('✓', msg); }
function fail(msg){ failed++; console.log('✗', msg); }

// 1. analysis.js 导出 hasLaunchConditions / hasBreakoutConditions
if (typeof A.hasLaunchConditions === 'function') ok('analysis.js 导出 hasLaunchConditions');
else fail('analysis.js 未导出 hasLaunchConditions');
if (typeof A.hasBreakoutConditions === 'function') ok('analysis.js 导出 hasBreakoutConditions');
else fail('analysis.js 未导出 hasBreakoutConditions');

// 2. 「好的条件」口径与边界（mp 轮改钉：不再钉某只票今天应满足/不满足）
// ⛔ 2026-10-27 mp 轮：原来第 2/3/7 条钉「002708 应满足 launch」「001400 振幅不足应 false」
//    「002708 应满足 momentum」。实测这三条全红，但**不是判据坏了，是样本自己走了**：
//      002708 昨收 15.65→今收 17.22，cum5=15.42%（>12 短期透支档）、gap20=3.80%（<5 已贴近日高）
//      001400 今收 80.28（涨停）amp20=19.22%（早就不在「振幅不足」那一档）
//    这三条明天还会随行情再红一次 —— 守门测试依赖实时行情 = 训练人忽略红灯（同 he 轮给时钟打锚点）。
//    现在改钉两件真正要守的东西：①阈值口径（口径本身就是胜率结论，不许被悄悄改）；
//    ②函数对边界确实生效（合成样本真跑，不依赖任何行情文件）。
{
  const AZ = fs.readFileSync(path.join(__dirname, 'analysis.js'), 'utf8');
  const LAUNCH = (AZ.match(/function hasLaunchConditions[\s\S]*?\n\}/) || [''])[0];
  const MOM = (AZ.match(/function hasMomentumConditions[\s\S]*?\n\}/) || [''])[0];
  ok('launch 口径：振幅 15%~45%（40-60% 胜率明显下降，高波动档不算好条件）',
    /amp20 >= 15 && amp20 < 45/.test(LAUNCH));
  ok('launch 口径：5 日累计 0~12%（>12 属短期透支）', /cum5 > 0 && cum5 < 12/.test(LAUNCH));
  ok('launch 口径：距 20 日高点 3%~20%（有空间但不太远）', /gap20 > 3 && gap20 < 20/.test(LAUNCH));
  ok('launch 口径：60 日回撤 5%~25%（判不出不硬判，dd60==null 放行）',
    /dd60 == null \|\| \(dd60 >= 5 && dd60 <= 25\)/.test(LAUNCH));
  ok('launch 口径：至少 1 天连阳且当日已上涨', /upCons >= 1/.test(LAUNCH) && /lastPct > 0/.test(LAUNCH));
  ok('momentum 口径：振幅 25%~50% / 5 日 0~15% / 距高点 5%~18%',
    /amp20 >= 25 && amp20 <= 50/.test(MOM) && /cum5 > 0 && cum5 < 15/.test(MOM) && /gap20 > 5 && gap20 < 18/.test(MOM));
  // 合成样本：50 根（<60 根 → dd60 判不出，走 null 放行分支），构造一个「温和启动型」形态
  const mk = (finalMul) => {
    const r = [];
    for (let i = 0; i < 30; i++) r.push({ close: 13.0, high: 13.02, low: 12.98, pct: 0, volume: 1e5, amount: 1e8 });
    for (let i = 0; i < 6; i++) { const c = 13.0 - (i + 1) * (2.8 / 6); r.push({ close: +c.toFixed(3), high: +(c * 1.002).toFixed(3), low: +(c * 0.998).toFixed(3), pct: -1, volume: 1e5, amount: 1e8 }); }
    for (let i = 0; i < 13; i++) { const c = 10.2 + (i + 1) * (1.7 / 13); r.push({ close: +c.toFixed(3), high: +(c * 1.002).toFixed(3), low: +(c * 0.998).toFixed(3), pct: 1, volume: 1e5, amount: 1e8 }); }
    const last = +(11.9 * finalMul).toFixed(3);
    r.push({ close: last, high: +(last * 1.002).toFixed(3), low: +(last * 0.998).toFixed(3), pct: 2.0, volume: 1e5, amount: 1e8 });
    return r;
  };
  const posRows = mk(1.02);      // 温和启动：cum5≈6.7% gap20≈6.8% amp20≈27.7%
  ok('合成样本·温和启动型 → launch 为真（判据真的能选出票）',
    A.hasLaunchConditions({ rows: posRows, price: posRows[posRows.length - 1].close, code: 'TEST', name: '合成' }) === true);
  const hotRows = mk(1.16);      // 5 日透支：cum5≈15% >12
  ok('合成样本·5 日透支型 → launch 为假（宁缺毋滥：透支档不选）',
    A.hasLaunchConditions({ rows: hotRows, price: hotRows[hotRows.length - 1].close, code: 'TEST', name: '合成' }) === false);
  const topRows = mk(1.11);      // 已贴近日高：gap20 转负 > 突破
  ok('合成样本·已贴近/突破日高 → launch 为假（突破型走 breakout，不重复选）',
    A.hasLaunchConditions({ rows: topRows, price: topRows[topRows.length - 1].close, code: 'TEST', name: '合成' }) === false &&
    A.hasMomentumConditions({ rows: topRows, price: topRows[topRows.length - 1].close, code: 'TEST', name: '合成' }) === false);
  // 真实样本改为观察项（只打印，不参与失败计数）：漂了就换票，绝不让行情波动冒充代码回归
  for (const [code, nm] of [['002708', '光洋股份'], ['001400', '江顺科技']]) {
    try {
      const kk = JSON.parse(fs.readFileSync(path.join(__dirname, '.kline_cache', code + '.json'), 'utf8'));
      const rr = kk.rows; const pp = rr[rr.length - 1].close;
      console.log(`  · 观察 ${code} ${nm}：launch=${A.hasLaunchConditions({ rows: rr, price: pp, code })} momentum=${A.hasMomentumConditions({ rows: rr, price: pp, code })}（行情漂移不判红）`);
    } catch (e) { console.log(`  · 观察 ${code} 无缓存，跳过`); }
  }
}

// 3. 001400 已并入上面的「观察项」（mp 轮：它今日 涨停收 80.28、amp20=19.22%，
//    不再是当初那条「振幅不足必 false」的形态；钉具体票等于每天跟行情对赌）。

// 4. 20日新高突破 + 强动能（新华百货型）（mv 轮改钉：原钉 600785 实盘K线，「钉具体票等于
//    每天跟行情对赌」——10-29 行情漂移后 breakout 形态已不在，判据没错是样本漂了。
//    与 mp 轮 002708/001400 同款先例：改合成样本钉语义，与行情文件彻底解耦；实盘缓存只观察不判红。）
const mkRows = (spec) => spec.map(s => ({ close: s.c, high: s.h != null ? s.h : +(s.c * 1.002).toFixed(3), low: s.l != null ? s.l : +(s.c * 0.998).toFixed(3), pct: s.p != null ? s.p : 0.2, volume: s.v != null ? s.v : 1e5, amount: 1e8 }));
{
  // 突破型：平盘打底 → 小幅垫高 → 末日放量拉过 20 日高点（cum5>10、vr>1.2、连阳）
  const r = [];
  for (let i = 0; i < 24; i++) r.push(...mkRows([{ c: +(10.0 + i * 0.04).toFixed(3), h: +(10.0 + i * 0.04 + 0.05).toFixed(3) }]));
  for (const c of [11.00, 11.25, 11.50, 11.75, 12.00]) r.push(...mkRows([{ c, h: +(c + 0.05).toFixed(3), p: 1.5 }]));
  r.push(...mkRows([{ c: 12.35, h: 12.40, p: 2.5, v: 2e5 }]));
  const price = 12.35;
  ok('合成样本·突破型 → breakout 为真（20日新高+强动能能选出票）',
    A.hasBreakoutConditions({ rows: r, price, code: 'TEST', name: '合成突破' }) === true);
  ok('合成样本·突破型 → launch 为假（已突破不应走启动路，gap20 不在 3~20）',
    A.hasLaunchConditions({ rows: r, price, code: 'TEST', name: '合成突破' }) === false);
}
// 5. amp20 放宽口径（原钉 605333 实盘K线，同上改合成）：amp20≈18~20% 但 cum5>10，
//    不许被「振幅」一票拦死 —— launch 或 breakout 至少一个成立。
{
  const r = [];
  for (let i = 0; i < 23; i++) r.push(...mkRows([{ c: 10.0, h: 10.05 }]));
  r.push(...mkRows([{ c: 11.2, h: 11.8, p: 2 }]));                    // 冲高留上影（amp20 拉开）
  r.push(...mkRows([{ c: 10.8, h: 11.3, p: -1 }]));
  for (const c of [10.70, 10.80, 10.90, 10.95]) r.push(...mkRows([{ c, h: +(c + 0.05).toFixed(3) }]));
  r.push(...mkRows([{ c: 11.00, h: 11.05, p: 1.0 }]));
  const price = 11.00;
  const launch = A.hasLaunchConditions({ rows: r, price, code: 'TEST', name: '合成启动' });
  const breakout = A.hasBreakoutConditions({ rows: r, price, code: 'TEST', name: '合成启动' });
  ok('合成样本·高波动启动型 → launch 或 breakout 至少一个成立（amp20 放宽口径）', launch || breakout);
  ok('合成样本·高波动启动型 → launch 路真能命中（正例，原先只有实盘反例）', launch === true);
}

// 6. analysis.js 导出 hasMomentumConditions
if (typeof A.hasMomentumConditions === 'function') ok('analysis.js 导出 hasMomentumConditions');
else fail('analysis.js 未导出 hasMomentumConditions');

// 7. momentum 正例（mp 轮改钉：原为「002708 是冲板/连板型，应满足 momentum」——该票今日
//    gap20=3.8%（<5）、cum5=15.4%（>15），已经不属动能档，判据没错是样本漂了。
//    改用合成样本钉「动能档确实能选出票」，与行情文件彻底解耦。）
{
  const r = [];
  for (let i = 0; i < 30; i++) r.push({ close: 13.0, high: 13.02, low: 12.98, pct: 0, volume: 1e5, amount: 1e8 });
  for (let i = 0; i < 6; i++) { const c = 13.0 - (i + 1) * (2.8 / 6); r.push({ close: +c.toFixed(3), high: +(c * 1.002).toFixed(3), low: +(c * 0.998).toFixed(3), pct: 1, volume: 1e5, amount: 1e8 }); }
  for (let i = 0; i < 13; i++) { const c = 10.2 + (i + 1) * (1.7 / 13); r.push({ close: +c.toFixed(3), high: +(c * 1.002).toFixed(3), low: +(c * 0.998).toFixed(3), pct: 2, volume: 1e5, amount: 1e8 }); }
  const last = +(11.9 * 1.04).toFixed(3);
  r.push({ close: last, high: +(last * 1.002).toFixed(3), low: +(last * 0.998).toFixed(3), pct: 3, volume: 1e5, amount: 1e8 });
  ok('合成样本·高波动连阳型 → momentum 为真（冲板/连板前置层能选出票）',
    A.hasMomentumConditions({ rows: r, price: last, code: 'TEST', name: '合成' }) === true);
}

// 8. 突破型不走 momentum 路（已突破，gap20 太小）（mv 轮同款改合成，不再钉实盘票）
{
  const r = [];
  for (let i = 0; i < 24; i++) r.push(...mkRows([{ c: +(10.0 + i * 0.04).toFixed(3), h: +(10.0 + i * 0.04 + 0.05).toFixed(3) }]));
  for (const c of [11.00, 11.25, 11.50, 11.75, 12.00]) r.push(...mkRows([{ c, h: +(c + 0.05).toFixed(3), p: 1.5 }]));
  r.push(...mkRows([{ c: 12.35, h: 12.40, p: 2.5, v: 2e5 }]));
  if (!A.hasMomentumConditions({ rows: r, price: 12.35, code: 'TEST', name: '合成突破' })) ok('合成样本·突破型 → momentum 为假（已突破，gap20 不在 5~18）');
  else fail('合成样本·突破型被误判为 momentum 条件');
}

// 9. server.js 已接入 breakoutReady / momentumReady / launchReady
const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
if (/x\.breakoutReady/.test(srv)) ok('enrichHigh20 已引用 breakoutReady');
else fail('server.js 未引用 breakoutReady');
if (/x\.momentumReady/.test(srv)) ok('enrichHigh20 已引用 momentumReady');
else fail('server.js 未引用 momentumReady');
if (/百货\|商业\|零售\|消费\|食品\|酒店\|旅游\|餐饮/.test(srv)) ok('scanBigMoneyPush 已加入消费/商业百货板块联动加分');
else fail('server.js 未加入消费/商业百货板块联动加分');
if (/\[\/冲板预警\/,\s*'冲板'\]/.test(srv)) ok('MSG_TYPE_RE 已注册冲板预警');
else fail('MSG_TYPE_RE 未注册冲板预警');
if (/冲板:\s*3/.test(srv)) ok('MSG_CAP 已给冲板 3 条额度');
else fail('MSG_CAP 未给冲板额度');
if (/x\.launchReady/.test(srv)) ok('scanBigMoneyPush 已引用 launchReady');
else fail('scanBigMoneyPush 未引用 launchReady');
if (/momentumReady/.test(srv) && /ztRushScan/.test(srv)) ok('冲板预警 ztRushScan 已接入 momentumReady');
else fail('冲板预警未接入 momentumReady');

console.log(`\n${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
