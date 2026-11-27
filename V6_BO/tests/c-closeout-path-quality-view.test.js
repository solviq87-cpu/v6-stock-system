'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const api=import('../public/nova/shortline/market.mjs');
const bt=import('../public/nova/shortline/backtest.mjs');
const research=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-27',code='600001';
const catalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
function state(n=41){
 const d=new Date(day+'T12:00:00Z'),ds=[];
 while(ds.length<n){if(![0,6].includes(d.getUTCDay()))ds.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}
 const bars=ds.map((date,i)=>{const close=100+i;return {code,date,name:'路径复核样本',role:'stock',period:'日K',priceBasis:'unadjusted',source:'原日K声明',open:close,high:close+1,low:close-1,close,volume:100000,...(i?{previousDay:ds[i-1]}:{})};});
 return {catalog,bars,market:[],trades:[],plans:[],checks:[]};
}
async function record(n=41){
 const s=state(n),b=s.bars.at(-1),r=(await research).buildChaseRiskResearch({b,history:s.bars.slice(0,-1),asOf:day+' 15:00',currentRows:[b]});
 return {date:day,code,name:b.name,recognition:{chaseRiskResearch:r,evidence:['原证据'],missing:[],candidates:[],ruleObservations:{}}};
}
const quality=r=>r.recognition.chaseRiskResearch.pathQuality;
const clone=x=>JSON.parse(JSON.stringify(x));
test('C38.1 original recognition, auto validation and historical replay return the same full path evidence',async()=>{
 const {deriveCheckInput,observations}=await bt,{autoValidate}=await api,s=state();
 const a=deriveCheckInput(s,{code,date:day}),b=autoValidate(s,{code,date:day}),h=observations(s,day,{code,all:true}).find(r=>r.date===day);
 assert.deepEqual(quality(a),quality(b));assert.deepEqual(h.features.chaseRiskResearch.pathQuality,quality(a));
 assert.ok(quality(a).windows.every(w=>w.recent&&w.preceding));
 assert.equal(quality(b).canTrade,false);
});
test('C38.2 original recognition details show three fixed windows, explicit units and read-only limits',async()=>{
 const {recognitionHTML}=await api,r=await record(),html=recognitionHTML(r.recognition,day);
 for(const n of [5,10,20])assert.ok(html.includes(n+'日窗口'));
 assert.match(html,/累计涨跌/);assert.match(html,/日对数波动/);assert.match(html,/最大收盘回撤/);
 assert.match(html,/单日最大上涨贡献/);assert.match(html,/百分点/);assert.match(html,/不是盘中轨迹、风险等级、预测胜率或开仓许可/);
 assert.match(html,/原交易门禁独立保留/);assert.match(html,/自动识别依据/);
});
test('C38.3 old records, wrong day, conflicting windows or invalid authority are not recomputed or shown as known',async()=>{
 const {recognitionHTML,pathQualityHTML}=await api,r=await record(),q=quality(r);
 assert.match(recognitionHTML({evidence:[],missing:[],candidates:[]},day),/未取得可核验的路径研究记录/);
 for(const patch of [{day:'2026-11-26'},{canTrade:true},{actualChaseRiskLevel:1},{priceBasis:'hfq'},{windows:[q.windows[0],q.windows[0],q.windows[2]]}]){
  const html=pathQualityHTML({...q,...patch},day);assert.match(html,/未取得可核验的路径研究记录/);assert.doesNotMatch(html,/累计涨跌/);
 }
});
test('C38.4 short history and numeric zero are distinct from unknown, no invented data',async()=>{
 const {pathQualityHTML}=await api,r=await record(7),q=clone(quality(r)),w=q.windows[0];
 w.recent.netReturnPct=0;w.recent.dailyLogVolatilityPct=0;w.recent.directionEfficiency=null;w.recent.largestGainSharePct='0';
 const html=pathQualityHTML(q,day);
 assert.match(html,/累计涨跌 0.00%/);assert.match(html,/日对数波动 0.00%/);
 assert.match(html,/方向效率 未取得/);assert.match(html,/单日最大上涨贡献 未取得/);
 assert.equal((html.match(/连续历史不足或证据未核验/g)||[]).length,2);
});
test('C38.5 mismatched preceding window cannot show acceleration or fake comparison',async()=>{
 const {pathQualityHTML}=await api,q=clone(quality(await record()));
 for(const w of q.windows)w.preceding.to=day;
 const html=pathQualityHTML(q,day);
 assert.equal((html.match(/相邻等长窗口比较未取得/g)||[]).length,3);
 assert.doesNotMatch(html,/净对数收益变化/);
});
test('C38.6 source and other display fields are escaped and invalid values stay unknown',async()=>{
 const {pathQualityHTML}=await api,q=clone(quality(await record()));
 q.source='<img src=x onerror=alert(1)>';q.windows[0].recent.directionEfficiency=2;
 q.windows[0].recent.maxCloseDrawdownPct=-1;q.windows[0].recent.dailyLogVolatilityPct=Infinity;
 const html=pathQualityHTML(q,day);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.match(html,/方向效率 未取得/);assert.match(html,/最大收盘回撤 未取得/);assert.match(html,/日对数波动 未取得/);
});
test('C38.7 historical rendering uses saved JSON only and preserves original recognition data',async()=>{
 const {recognitionHTML}=await api,r=clone(await record()),before=JSON.stringify(r);
 const html=recognitionHTML(r.recognition,r.date);assert.equal(JSON.stringify(r),before);
 assert.equal(html,recognitionHTML(r.recognition,r.date));
 assert.match(html,/声明来源：原日K声明/);
 assert.ok(r.recognition.ruleObservations);assert.ok(Array.isArray(r.recognition.evidence));
});
test('C38.8 CSV retains existing columns in order and appends three research windows; missing records remain explicit',async()=>{
 const {exportRows}=await api,r=clone(await record()),legacy={...r,recognition:{evidence:[],missing:[]}};
 r.recognition.chaseRiskResearch.pathQuality.source='=original-source';
 let file;exportRows({download:(name,content,type)=>{file={name,content,type};}},[r,legacy]);
 assert.equal(file.name,'战法校验记录.csv');assert.match(file.content,/^\ufeff"交易日","标的代码","标的名称"/);
 assert.match(file.content,/"识别方式","识别依据","缺失证据","路径研究来源及日期","5日路径研究","10日路径研究","20日路径研究"/);
 assert.match(file.content,/"'=original-source/);assert.match(file.content,/"未取得","连续历史不足或证据未核验"/);
 assert.match(file.content,/最大收盘回撤/);
});
