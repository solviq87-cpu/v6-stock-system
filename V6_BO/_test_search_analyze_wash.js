// 守门：hm 轮「② 洗盘/出货接决策（仅预警不干预）+ ⑤ 个股搜索+分析」
//   ② 洗盘/出货接决策：新增 scanWashDistributeAlerts —— 持仓票出货/洗盘信号私密推送。
//      ⛔ 铁律：只发预警，绝不调用模拟盘卖出函数（paperSell），不干预仓位。
//   ⑤ 个股搜索+分析：/api/search（代码/名称匹配）+ /api/analyze（聚合 K线均线/算法点/资金流/洗盘出货/当日简析）。
'use strict';
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');

const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SVK = stripNoise(SV, { keepStrings: true });
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const HTMLK = stripNoise(HTML, { keepStrings: true });

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') { console.log('❌ [类型闸] ' + name + ' 入参非布尔: ' + typeof cond); fail++; return; }
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? ' | ' + detail : '')); }
}
// 花括号配平取函数体（支持 async / 普通 function；禁止固定行号窗口 —— gd 轮铁律）
function bodyAt(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return '';
  const start = src.indexOf('{', m.index);
  let d = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

console.log('\n[1] ⑤ 个股搜索 + 分析：后端接口契约');
{
  const searchBlk = (() => {
    const i = SVK.indexOf("p === '/api/search' && req.method === 'GET'");
    return i < 0 ? '' : SVK.slice(i, i + 700);
  })();
  const anaBlk = (() => {
    const i = SVK.indexOf("p === '/api/analyze' && req.method === 'GET'");
    return i < 0 ? '' : SVK.slice(i, i + 1100);
  })();
  ok(!!searchBlk && /S\.stocks/.test(searchBlk) && /S\.ztPool/.test(searchBlk), '/api/search 只读全市场快照 S.stocks / S.ztPool（无私密数据）');
  ok(!!searchBlk && /code\.indexOf\(ql\)\s*>=\s*0\s*\|\|\s*name\.toLowerCase\(\)\.indexOf\(ql\)\s*>=\s*0/.test(searchBlk), '/api/search 支持代码前缀与名称子串匹配');
  ok(!!anaBlk && /analyzeStock\(code,\s*isEditorReq\(req,\s*tok\)\)/.test(anaBlk), '/api/analyze 调用 analyzeStock 并按 isEditorReq 裁剪私密层');
  const af = bodyAt(SVK, 'analyzeStock');
  ok(!!af, 'analyzeStock 函数存在');
  ok(!!af && /klineRows\(code\)/.test(af), 'analyzeStock 走 klineRows（与精选池同源三级缓存）');
  ok(!!af && /klineMaOf\(tail\)/.test(af), 'analyzeStock 下发均线 MA');
  ok(!!af && /klineMarksOf\(code,\s*tail\)/.test(af), 'analyzeStock 下发算法买卖点/锁仓标注');
  ok(!!af && /washVsDistribute\(tail,\s*flowRec\)/.test(af), 'analyzeStock 含洗盘/出货判定');
  ok(!!af && /klineFlowOf\(code\)/.test(af), 'analyzeStock 含当日四级资金流');
  ok(!!af && /briefOfDay\(tail,\s*tail\.length\s*-\s*1,\s*mk/.test(af), 'analyzeStock 含当日聚焦简析 briefOfDay');
  ok(!!af && /paperHidden/.test(af), 'analyzeStock 只读身份给 paperHidden 说明（私密层不漏）');
}

console.log('\n[2] ② 洗盘/出货接决策：持仓票预警（仅预警不干预）');
{
  const wf = bodyAt(SVK, 'scanWashDistributeAlerts');
  ok(!!wf, 'scanWashDistributeAlerts 函数存在');
  ok(!!wf && /isReplica\(\)/.test(wf), 'scanWashDistributeAlerts 首判 isReplica()：副本只同步不主动外发');
  ok(!!wf && /isDataWindow\(\)/.test(wf) && /isTradingTime\(\)/.test(wf), '仅在交易时段内跑，避免非交易数据噪声');
  ok(!!wf && /heldCodes\(\)/.test(wf), '遍历持仓（heldCodes）做判定');
  ok(!!wf && /washVsDistribute\(tail,\s*flowRec\)/.test(wf), '调用 washVsDistribute 判定');
  ok(!!wf && /pushAll\([\s\S]*?private:\s*true/.test(wf), '命中时私密推送（{private:true}）');
  ok(!!wf && /paperSell/.test(wf) === false, '⛔ 绝不调用模拟盘卖出函数 paperSell（仅预警不干预）');
  ok(!!wf && /(仅预警|不自动操作|不干预)/.test(wf), '推送文案明示「仅预警/不自动操作/不干预」');
  ok(!!wf && /_washWarnSent\.has\(/.test(wf), '当日去重（_washWarnSent），不重复骚扰');
  const hc = bodyAt(SVK, 'heldCodes');
  ok(!!hc && /PAPER_CFG/.test(hc) && /Number\(p\.shares\)\s*>\s*0/.test(hc), 'heldCodes 取实持仓（shares>0）');
  const hook = SVK.indexOf("setInterval(guard('wash-alert'");
  ok(hook >= 0, '已挂定时器 guard(\'wash-alert\') 周期扫描（每 15 分钟）');
}

console.log('\n[3] ⑤ 前端：搜索框 + 分析视图');
{
  ok(/id="searchBox"/.test(HTML), '面板含搜索输入框 searchBox');
  ok(/function onSearchInput\(/.test(HTMLK), 'onSearchInput 防抖搜索');
  ok(/function pickAnalyze\(/.test(HTMLK), 'pickAnalyze 拉 /api/analyze');
  ok(/function renderAnalyze\(/.test(HTMLK), 'renderAnalyze 渲染分析卡片');
  ok(/id="analyzeBox"/.test(HTML), '分析卡片容器 analyzeBox');
  ok(/fetch\('\/api\/analyze\?code='\s*\+\s*encodeURIComponent\(code\)\s*\+\s*'&token='/.test(HTMLK), 'pickAnalyze 带 token 拉 /api/analyze（私密层正确裁剪）');
  ok(/fetch\('\/api\/search\?q='/.test(HTMLK), 'onSearchInput/doSearch 拉 /api/search');
  ok(/洗盘倾向/.test(HTMLK) && /出货倾向/.test(HTMLK), '分析卡片洗盘/出货配色与 K线面板同源（🧊洗盘/📤出货）');
  ok(/f\.source\s*===\s*'ths'/.test(HTMLK), '分析卡片资金流同样处理同花顺兜底源 source=ths');
  ok(HTML.includes("openKline('${d.code}')"), '分析卡片可一键打开 K线面板看买卖点/量能');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
