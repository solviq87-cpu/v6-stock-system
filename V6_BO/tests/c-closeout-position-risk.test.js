'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const code='600001',day='2026-11-27',at=day+' 15:00';
function dates(n=41){
 const d=new Date(day+'T12:00:00Z'),out=[];
 while(out.length<n){if(![0,6].includes(d.getUTCDay()))out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}
 return out;
}
function series(n=41,flat=false){
 const ds=dates(n);
 return ds.map((date,i)=>{const close=flat?100:100+i;return {code,date,role:'stock',period:'日K',priceBasis:'unadjusted',source:'合成同源日K',
  sampleSet:'real',sampleSource:'合成验收夹具',open:close,high:flat?close:close+1,low:flat?close:close-1,close,volume:100000,
  ...(i?{previousDay:ds[i-1]}:{})};});
}
async function scan(rows,extra={}){
 const b=rows.at(-1);return (await api).buildChaseRiskResearch({b,history:rows.slice(0,-1),asOf:at,currentRows:[b],...extra});
}
const window=(p,h)=>p.returns.find(x=>x.sessions===h);
const ma=(p,h)=>p.movingAverages.find(x=>x.sessions===h);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,'expected '+b+' got '+a);
test('C28.1 exact 1/5/10/20 session returns and prior-endpoint percentiles exclude current day',async()=>{
 const rows=series(),r=await scan(rows),p=r.positionRisk;
 assert.equal(p.contiguousPriorBars,40);assert.equal(p.referenceClose,140);assert.equal(p.canTrade,false);
 for(const h of [1,5,10,20]){
  const w=window(p,h);near(w.returnPct,100*(140/(140-h)-1));assert.equal(w.historicalRankPct,0);
  assert.equal(w.historicalEndpointCount,20);assert.equal(w.historyFrom,rows[20].date);assert.equal(w.historyTo,rows[39].date);
  assert.equal(w.from,rows[40-h].date);assert.equal(w.to,day);
 }
 assert.equal(p.historicalPercentileBasis,'20-prior-overlapping-return-endpoints-midrank-not-probability');
});
test('C28.1 own-history rank treats all ties as midpoint not a probability or a risk score',async()=>{
 const p=(await scan(series(41,true))).positionRisk;
 for(const w of p.returns){assert.equal(w.returnPct,0);assert.equal(w.historicalRankPct,50);}
 assert.equal(p.atr14.value,0);assert.equal(p.atr14.distanceFromMa20,null);
 for(const x of p.movingAverages)assert.equal(x.deviationPct,0);
 assert.equal(p.openingGapPct,0);
});
test('C28.1 observed returns and the fixed sample are separate when history is short',async()=>{
 const p=(await scan(series(26))).positionRisk;
 assert.equal(p.contiguousPriorBars,25);assert.equal(window(p,5).historicalEndpointCount,20);
 assert.equal(window(p,10).historicalRankPct,null);assert.equal(window(p,20).historicalRankPct,null);
 near(window(p,20).returnPct,100*(125/105-1));
 const short=(await scan(series(4))).positionRisk;
 assert.equal(window(short,5).returnPct,null);assert.equal(ma(short,5).average,null);assert.equal(short.atr14,null);
});
test('C28.2 ordinary simple moving averages include current close and ATR uses prior close',async()=>{
 const p=(await scan(series())).positionRisk;
 near(ma(p,5).average,138);near(ma(p,10).average,135.5);near(ma(p,20).average,130.5);
 near(ma(p,20).deviationPct,100*(140/130.5-1));near(p.atr14.value,2);
 near(p.atr14.pctOfClose,100*2/140);near(p.atr14.distanceFromMa20,4.75);
 near(p.openingGapPct,100*(140/139-1));assert.equal(p.atr14.basis,'simple-average-of-14-true-ranges-including-gap-not-Wilder');
 const rows=series(),b=rows.at(-1);Object.assign(b,{open:144,close:144,high:145,low:143});
 const gap=(await scan(rows)).positionRisk;near(gap.atr14.value,32/14);near(gap.openingGapPct,100*(144/139-1));
});
test('C28.3 one source, explicit unadjusted prices and sample family are necessary for the new continuous history',async()=>{
 for(const patch of [{source:'另一来源'},{priceBasis:'hfq'},{corporateAction:true},{noPriceLimit:true},{suspended:true},{sampleSet:'test'},{sampleSource:'other'},{knownAt:day+' 15:01'}]){
  const rows=series();Object.assign(rows[35],patch);const p=(await scan(rows)).positionRisk;
  assert.equal(p.contiguousPriorBars,4);assert.equal(window(p,5).returnPct,null);assert.equal(ma(p,10).average,null);assert.equal(p.atr14,null);
 }
 const unknown=series();delete unknown.at(-1).source;
 assert.equal((await scan(unknown)).positionRisk,null);
});
test('C28.3 conflicting same-day history is a gap; equal duplicate and late correction do not rewrite the observation',async()=>{
 const rows=series(),past=rows[35],b=rows.at(-1);
 const x=await scan(rows,{history:[...rows.slice(0,-1),{...past,close:past.close+.5}]});
 assert.equal(x.positionRisk.contiguousPriorBars,4);
 const same=await scan(rows,{history:[...rows.slice(0,-1),{...past}]});
 assert.equal(same.positionRisk.contiguousPriorBars,40);
 const late=await scan(rows,{history:[...rows.slice(0,-1),{...past,close:past.close+.5,knownAt:day+' 15:01'}]});
 assert.equal(late.positionRisk.contiguousPriorBars,40);
 const mixed=await scan(rows,{history:[...rows.slice(0,-1),{...past,sampleSet:'test'}]});
 assert.equal(mixed.positionRisk.contiguousPriorBars,4);
 assert.equal((await scan(rows,{currentRows:[b,{...b,sampleSource:'other'}]})).positionRisk,null);
});
test('C28.3 no weekend/calendar guessing beyond existing declared chain; missing predecessor stops the window',async()=>{
 const rows=series();rows.splice(36,1);
 const p=(await scan(rows)).positionRisk;assert.equal(p.contiguousPriorBars,3);
 assert.equal(window(p,5).returnPct,null);
 assert.equal(p.continuity,'declared-previous-day-or-weekday-chain-not-calendar-certified');
 const invalid=series();invalid.at(-1).previousDay=day;
 assert.equal((await scan(invalid)).positionRisk.contiguousPriorBars,0);
});
test('C28.4 large finite prices and arithmetic overflow cannot generate infinite display metrics',async()=>{
 const rows=series(41,true);
 for(const r of rows)Object.assign(r,{open:1e308,close:1e308,low:1e308,high:1e308});
 const p=(await scan(rows)).positionRisk;assert.equal(ma(p,20).average,1e308);assert.equal(p.atr14.value,0);
 const x=series();for(const r of x.slice(0,-1))Object.assign(r,{open:1e-308,close:1e-308,high:1e-308,low:1e-308});
 Object.assign(x.at(-1),{open:1e308,close:1e308,high:1e308,low:1e308});
 const q=(await scan(x)).positionRisk;
 assert.equal(window(q,1).returnPct,null);assert.equal(window(q,1).historicalRankPct,null);assert.equal(q.openingGapPct,null);
});
test('C28.5 historical position research cannot change existing risk evidence or add trading authority',async()=>{
 const {buildChaseRiskResearch,addStockRiskEvidence}=await api,rows=series(),b=rows.at(-1),history=rows.slice(0,-1);
 const r=buildChaseRiskResearch({b,history,asOf:at});assert.equal(r.canTrade,false);assert.equal(r.positionRisk.canTrade,false);
 assert.equal(r.priceRange.count,20);assert.equal(r.priceRange.aboveRange,false);
 const facts=new Map();addStockRiskEvidence({b,history,asOf:at},facts);
 assert.ok([...facts.keys()].every(k=>typeof k==='string'&&!k.includes('positionRisk')));
});
test('C28.integration original recognition and historical observations retain identical position metrics',async()=>{
 const {deriveCheckInput,observations}=await import('../public/nova/shortline/backtest.mjs'),{autoValidate}=await import('../public/nova/shortline/market.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 // The original archive separates explicitly marked test/real samples; these
 // constructed rows exercise the real-schema read path without claiming real quotes.
 const bars=series().map(r=>{const {sampleSet,sampleSource,...rest}=r;return rest});
 const state={catalog,bars,market:[],trades:[],plans:[]};
 const a=deriveCheckInput(state,{code,date:day}),z=autoValidate(state,{code,date:day});
 const p=a.recognition.chaseRiskResearch.positionRisk;
 assert.equal(p.contiguousPriorBars,40);near(window(p,20).returnPct,100*(140/120-1));
 assert.equal(z.recognition.chaseRiskResearch.positionRisk.contiguousPriorBars,40);
 const historical=observations(state,day,{code,all:true}).find(r=>r.date===day);
 assert.equal(historical.features.chaseRiskResearch.positionRisk.contiguousPriorBars,40);
 near(window(historical.features.chaseRiskResearch.positionRisk,20).returnPct,window(p,20).returnPct);
});
