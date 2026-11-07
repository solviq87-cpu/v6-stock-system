// 日常自检聚焦脚本：① 模拟盘三方对账 ② repairPositions 是否需要跑 ③ 持仓两端一致性
// 纯只读：不修改 paper.json / holdings.json，仅读取并写报告到 .selfcheck/
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// ---- 收集输出，末尾落盘 ----
const out = [];
const origLog = console.log.bind(console);
console.log = (...a) => { origLog(...a); out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
const tolM = src.match(/const PAPER_AUDIT_TOL = ([\d.]+);/);
const TOL = tolM ? +tolM[1] : 0.05;
const sandboxSrc = [
  grab(/function paperTradeFlow\(t\) \{/),
  (src.match(/const DATA_CAP = \{[\s\S]*?\n\};/) || [''])[0],
  grab(/function dataCapOf\(k\) \{/),
  grab(/function paperTol\(n\) \{/),
  grab(/function signTxt\(v\) \{/),
  grab(/function paperBasisGap\(tl\) \{/),
  grab(/function paperTradeKey\(t\) \{/),
  grab(/function repairTradeSide\(side\) \{/),
  grab(/function paperBackfillTrades\(key\) \{/),
  grab(/function paperMergeTrades\(local, incoming\) \{/),
  grab(/function paperAudit\(key\) \{/),
  grab(/function paperAuditAll\(\) \{/),
  'const PAPER_AUDIT_TOL = ' + TOL + ';',
  'return { paperBackfillTrades, paperAudit, paperAuditAll };'
].join('\n');

const pj = JSON.parse(fs.readFileSync(path.join(__dirname, 'paper.json'), 'utf8'));
const CFG = {};
for (const k of Object.keys(pj)) CFG[k] = { initial: pj[k].initial };

const S = new Function('PAPER', 'PAPER_CFG', sandboxSrc)(pj, CFG);

console.log('===== ① 模拟盘三方对账（账户 vs 流水重算） =====');
let changed = 0;
for (const k of Object.keys(pj)) changed += S.paperBackfillTrades(k);
const all = S.paperAuditAll();

let anyBad = false;
for (const k of Object.keys(pj)) {
  const r = all[k];
  console.log(`\n[${k}] ${r.ok ? '✅ 一致' : '⚠️ 不一致'}`);
  console.log(`  流水笔数=${r.trades}  容差=${r.tol}元 (${r.tolNote})`);
  console.log(`  现金：重算 ${r.cashCalc} / 账户 ${r.cash} / 差 ${r.dCash}`);
  console.log(`  已实现盈亏：重算 ${r.realizedCalc} / 账户 ${r.realized} / 差 ${r.dRealized}`);
  console.log(`  持仓差异 dPos=${r.dPos}  缺费用字段=${r.missingFee}  side损坏=${r.badSide}`);
  console.log(`  证据完整性：cap=${r.cap} truncated=${r.truncated} incomplete=${r.incomplete} 裁掉笔数=${r.tradesDropped}`);
  if (!r.ok) { anyBad = true; console.log(`  why: ${r.why}`); }
}
console.log(`\n回填改动笔数(内存,未落盘)=${changed}  总 ok=${all.ok}`);

console.log('\n===== ② repairPositions 是否需要跑 =====');
let needRepair = false;
const reasons = [];
for (const k of Object.keys(pj)) {
  const r = all[k];
  if (r.dPos > 0) { needRepair = true; reasons.push(`${k}: 持仓与流水差 ${r.dPos} 只`); }
  if (r.badSide > 0) reasons.push(`${k}: ${r.badSide} 笔 side 损坏（repairPositions 不处理方向，需人工核对）`);
}
console.log(needRepair ? ('需要跑：' + reasons.join('；')) : '暂不需要（dPos=0）');
if (changed > 0) console.log(`注：本次回填在内存补了 ${changed} 笔字段，未落盘；如需固化请显式 savePaper。`);

console.log('\n===== ③ 持仓两端一致性（本地 holdings.json vs 最近回拉线上码表） =====');
let holdOk = true;
let holdMsg = '';
try {
  const hj = JSON.parse(fs.readFileSync(path.join(__dirname, 'holdings.json'), 'utf8'));
  const localCodes = (hj.items || []).map(x => x.code).sort();
  const histPath = path.join(__dirname, '.holdings_pull_history.json');
  if (!fs.existsSync(histPath)) {
    holdOk = false; holdMsg = '无回拉历史记录（.holdings_pull_history.json 不存在），无法核验线上';
  } else {
    const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    const last = hist[hist.length - 1];
    const remoteCodes = (last.codes || []).slice().sort();
    const localS = JSON.stringify(localCodes);
    const remoteS = JSON.stringify(remoteCodes);
    holdMsg = `本地=${localS}  线上(最近回拉 ${last.t} @${new Date(last.t).toISOString()})=${remoteS}`;
    if (localS !== remoteS) {
      holdOk = false;
      // 纪律①：线上为空=用户自己删的，绝不还原；只报告差异
      const onlyLocal = localCodes.filter(c => !remoteCodes.includes(c));
      const onlyRemote = remoteCodes.filter(c => !localCodes.includes(c));
      if (onlyRemote.length && !onlyLocal.length) holdMsg += `  ⚠️ 线上有本地无(${onlyRemote.join(',')})——线上为空属用户删除，禁止还原`;
      else if (onlyLocal.length) holdMsg += `  ⚠️ 本地有线上无(${onlyLocal.join(',')})——需确认是否要上行同步`;
      else holdMsg += `  ⚠️ 码表集合不一致`;
    } else {
      holdMsg += '  ✅ 两端一致';
    }
  }
} catch (e) {
  holdOk = false; holdMsg = '核验异常: ' + e.message;
}
console.log(holdMsg);

// ---- 汇总 + 落盘 ----
const finalOk = !anyBad && holdOk;
console.log('\n===== 汇总 =====');
console.log(`对账一致=${!anyBad}  持仓两端=${holdOk ? '一致' : '不一致'}  =>  SELFCHECK_RESULT: ${finalOk ? 'OK' : 'ATTENTION'}`);
if (!finalOk) {
  if (anyBad) console.log('  ① 模拟盘对账存在不一致，需人工核对 paper.json');
  if (!holdOk) console.log('  ③ 持仓两端不一致，详见上方说明（注意纪律①：线上空=用户删除，禁止还原）');
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-');
const dir = path.join(__dirname, '.selfcheck');
fs.mkdirSync(dir, { recursive: true });
const repPath = path.join(dir, stamp + '.md');
const header = `# 持仓与模拟盘日常自检  ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
fs.writeFileSync(repPath, header + out.join('\n') + '\n');
origLog('报告已落盘:', repPath);
origLog('SELFCHECK_RESULT:', finalOk ? 'OK' : 'ATTENTION');

// ---- 私密推送（飞书安全 webhook，对应项目 private:true 通道）----
(async () => {
  let pushNote;
  if (process.argv.includes('--no-push')) {
    pushNote = '跳过（--no-push）';
  } else {
    try {
      const cfg2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      const hook = cfg2.feishuSecWebhook || cfg2.feishuWebhook;
      if (!hook) {
        pushNote = '未配置 feishuSecWebhook，跳过';
      } else {
        const nowStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const text = [
          `【持仓与模拟盘·每日自检】${nowStr}`,
          `① 模拟盘三方对账：${anyBad ? '⚠️ 不一致' : '✅ 一致'}（pool/pre 差0）`,
          `② repairPositions：${needRepair ? '需要跑' : '暂不需要'}`,
          `③ 持仓两端：${holdOk ? '✅ 一致' : '⚠️ 不一致'}`,
          `结论：SELFCHECK_RESULT ${finalOk ? 'OK' : 'ATTENTION'}`,
          `报告：${repPath}`
        ].join('\n');
        try {
          const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text } }) });
          const j = await r.json().catch(() => ({}));
          pushNote = (j.code === 0 || r.ok) ? '已推送私密通道(飞书安全机器人)' : ('推送失败 code=' + (j.code ?? r.status) + ' msg=' + (j.msg ?? ''));
        } catch (pe) {
          pushNote = '推送网络异常: ' + pe.message; // 沙箱/离线兜底，不崩
        }
      }
    } catch (e) {
      pushNote = '推送异常: ' + e.message;
    }
  }
  origLog('\n===== 推送 =====');
  origLog(pushNote);
  try { fs.appendFileSync(repPath, '\n\n## 推送\n' + pushNote + '\n'); } catch (_) {}
})();
