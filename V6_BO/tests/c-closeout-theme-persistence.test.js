'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const code='600001',day='2026-11-27',at=day+' 15:00';
function dates(n=41){const d=new Date(day+'T12:00:00Z'),out=[];while(out.length<n){if(![0,6].includes(d.getUTCDay()))out.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1);}return out;}
function fixture(n=41){
 const ds=dates(n),series=(role,code,source,price)=>ds.map((date,i)=>{const close=price(i);return {code,date,role,period:'日K',priceBasis:'unadjusted',source,open:close,high:close+1,low:close-1,close,volume:100000,...(i?{previousDay:ds[i-1]}:{})};});
 const stocks=series('stock',code,'stock-source',i=>100+2*i).map((r,i)=>({...r,sector:'算力',indexCode:'000001',sectorAssists:Math.max(0,n-i-1),sectorAdvancingCount:Math.max(0,20-(i-(n-5))*3),sectorObservedCount:20,sectorTotalCount:20,sectorBreadthSource:'breadth-provider',sectorBreadthAt:r.date+' 15:00',sectorBreadthReceivedAt:r.date+' 15:00'}));
 const sectors=series('sector','BK001','sector-source',i=>100+i).map(r=>({...r,sector:'算力'}));
 const indices=series('index','000001','index-source',i=>100+.5*i);
 return {stocks,sectors,indices};
}
async function run(f,extra={}){const b=f.stocks.at(-1);return (await api).buildChaseRiskResearch({b,history:f.stocks.slice(0,-1),asOf:at,currentRows:[b],sectorRows:f.sectors,indexRows:f.indices,...extra});}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,'expected '+b+' got '+a);
const win=(p,h)=>p.windows.find(x=>x.sessions===h);
test('C29.1 original sector series has own-history position metrics, distinct from stock and index',async()=>{
 const f=fixture(),r=await run(f),s=r.sectorPositionRisk;
 assert.equal(s.sector,'算力');assert.equal(s.code,'BK001');assert.equal(s.referenceClose,140);assert.equal(s.contiguousPriorBars,40);
 assert.equal(s.source,'sector-source');near(s.returns.find(x=>x.sessions===20).returnPct,100*(140/120-1));
 assert.equal(s.returns.find(x=>x.sessions===20).historicalRankPct,0);near(s.movingAverages[2].average,130.5);
 near(s.atr14.value,2);assert.equal(s.canTrade,false);assert.equal(r.positionRisk.referenceClose,180);
});
test('C29.2 multi-window comparisons use identical dates and own-series returns with distinct vendors',async()=>{
 const f=fixture(),p=(await run(f)).multiWindowRelativeStrength;
 for(const h of [1,5,10,20]){const w=win(p,h);assert.equal(w.sector.from,f.stocks[40-h].date);assert.equal(w.index.from,w.sector.from);assert.equal(w.sector.to,day);
  near(w.sector.stockReturnPct,100*(180/(180-2*h)-1));near(w.sector.benchmarkReturnPct,100*(140/(140-h)-1));
  near(w.index.benchmarkReturnPct,100*(120/(120-.5*h)-1));near(w.sector.excessPctPoints,w.sector.stockReturnPct-w.sector.benchmarkReturnPct);
 }
 assert.equal(p.shorterExcessBelowLonger.sector,true);assert.equal(p.canTrade,false);
});
test('C29.2 relative resilience remains distinct from an absolute stock loss',async()=>{
 const f=fixture();for(const [rows,p] of [[f.stocks,1],[f.sectors,2],[f.indices,3]])for(let i=0;i<rows.length;i++){const close=300-i*p;Object.assign(rows[i],{open:close,close,low:close-1,high:close+1});}
 const w=win((await run(f)).multiWindowRelativeStrength,5);
 assert.equal(w.sector.stockAbsoluteDown,true);assert.equal(w.sector.benchmarkAbsoluteDown,true);
 assert.ok(w.sector.excessPctPoints>0);assert.ok(w.sector.stockReturnPct<0);
});
test('C29.3 missing, conflicted, changed source or price basis terminates only that benchmark',async()=>{
 for(const patch of [{source:'other'},{priceBasis:'hfq'},{sourceConflict:true},{knownAt:day+' 15:01'},{sampleSet:'test'},{sector:'医药'}]){
  const f=fixture();Object.assign(f.sectors[35],patch);const r=await run(f);
  assert.equal(r.sectorPositionRisk.contiguousPriorBars,4);assert.equal(win(r.multiWindowRelativeStrength,5).sector,null);
  assert.ok(win(r.multiWindowRelativeStrength,20).index);assert.equal(r.positionRisk.contiguousPriorBars,40);
 }
 const f=fixture();delete f.stocks.at(-1).indexCode;
 const r=await run(f);assert.equal(r.multiWindowRelativeStrength.index,null);assert.ok(win(r.multiWindowRelativeStrength,20).sector);
});
test('C29.3 explicit sector identity, current duplicate conflict and sample isolation are fail closed',async()=>{
 const f=fixture(),cur=f.sectors.at(-1);
 for(const other of [{...cur,code:'BK002'},{...cur,close:cur.close+.5},{...cur,sector:'医药'}]){
  const r=await run(f,{sectorRows:[...f.sectors,other]});assert.equal(r.sectorPositionRisk,null);assert.equal(win(r.multiWindowRelativeStrength,1).sector,null);
 }
 const same=await run(f,{sectorRows:[...f.sectors,{...cur}]});assert.equal(same.sectorPositionRisk.contiguousPriorBars,40);
 const late=await run(f,{sectorRows:[...f.sectors,{...cur,close:cur.close+.5,knownAt:day+' 15:01'}]});
 assert.equal(late.sectorPositionRisk.contiguousPriorBars,40);
 const bad=fixture();bad.sectors.at(-1).sampleSet='test';assert.equal((await run(bad)).sectorPositionRisk,null);
});
test('C29.3 exact intermediate session dates and historical theme continuity are required, not endpoint-only',async()=>{
 const f=fixture();f.stocks[37].sector='医药';let r=await run(f);
 assert.ok(r.sectorPositionRisk);assert.ok(win(r.multiWindowRelativeStrength,1).sector);
 assert.equal(win(r.multiWindowRelativeStrength,5).sector,null);assert.ok(win(r.multiWindowRelativeStrength,5).index);
 const g=fixture();g.indices[40].previousDay=g.indices[38].date;
 r=await run(g);assert.equal(win(r.multiWindowRelativeStrength,1).index,null);assert.equal(win(r.multiWindowRelativeStrength,5).index,null);
 assert.ok(win(r.multiWindowRelativeStrength,5).sector);
});
test('C29.4 breadth and seal assists have independent three and five daily persistence evidence',async()=>{
 const r=await run(fixture()),p=r.themePersistence,w= p.windows.find(x=>x.days===5);
 assert.equal(p.canTrade,false);assert.equal(w.breadth.declaredTotal,20);assert.equal(w.breadth.days[0].value,100);
 assert.equal(w.breadth.days.at(-1).value,40);assert.equal(w.breadth.decliningTransitions,4);assert.equal(w.breadth.strictlyDeclining,true);
 assert.equal(w.sealAssists.days.at(-1).value,0);assert.equal(w.sealAssists.delta,-4);
 assert.equal(p.windows[0].breadth.decliningTransitions,2);assert.equal(p.basis,'descriptive-daily-persistence-not-intraday-warning-or-collapse-classifier');
});
test('C29.4 missing breadth, changed denominator or delayed receipt does not fabricate full counts from assists',async()=>{
 for(const patch of [{sectorObservedCount:19},{sectorTotalCount:21},{sectorBreadthSource:'other'},{sectorBreadthReceivedAt:day+' 15:01'},{sectorAdvancingCount:null}]){
  const f=fixture();Object.assign(f.stocks[36],patch);const p=(await run(f)).themePersistence;
  assert.equal(p.windows[1].breadth,null);assert.ok(p.windows[1].sealAssists);assert.ok(p.windows[0].breadth);
 }
 const f=fixture();f.stocks[36].sectorAssists=null;const p=(await run(f)).themePersistence;
 assert.ok(p.windows[1].breadth);assert.equal(p.windows[1].sealAssists,null);
});
test('C29.4 same-day conflicting theme versions cannot renew persistence; true flat counts are not decline',async()=>{
 const f=fixture();for(const r of f.stocks.slice(-5)){r.sectorAdvancingCount=0;r.sectorAssists=0;}
 let p=(await run(f)).themePersistence;assert.equal(p.windows[1].breadth.unchangedTransitions,4);assert.equal(p.windows[1].breadth.strictlyDeclining,false);
 assert.equal(p.windows[1].sealAssists.delta,0);const past=f.stocks[36];
 p=(await run(f,{history:[...f.stocks.slice(0,-1),{...past,sectorAssists:1}]})).themePersistence;
 assert.equal(p.windows[1].breadth,null);assert.equal(p.windows[1].sealAssists,null);assert.ok(p.windows[0].breadth);
});
test('C29.5 no benchmark data does not manufacture context from existing derived change fields',async()=>{
 const f=fixture(),r=await run(f,{sectorRows:[],indexRows:[],market:{date:day,indexChange:5},sector:{date:day,change:8}});
 assert.equal(r.sectorPositionRisk,null);assert.equal(r.multiWindowRelativeStrength,null);assert.ok(r.positionRisk);assert.ok(r.themePersistence);
 assert.equal(r.canTrade,false);
});
test('C29.integration existing recognition and historical replay consume original bounded sector and explicit index series',async()=>{
 const {deriveCheckInput,observations}=await import('../public/nova/shortline/backtest.mjs'),{autoValidate}=await import('../public/nova/shortline/market.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 const f=fixture(),state={catalog,bars:[...f.stocks,...f.sectors,...f.indices],market:[],trades:[],plans:[]};
 const a=deriveCheckInput(state,{code,date:day}).recognition.chaseRiskResearch,b=autoValidate(state,{code,date:day}).recognition.chaseRiskResearch;
 const h=observations(state,day,{code,all:true}).find(r=>r.date===day).features.chaseRiskResearch;
 for(const r of [a,b,h]){assert.equal(r.sectorPositionRisk.contiguousPriorBars,40);assert.equal(win(r.multiWindowRelativeStrength,20).index.from,f.stocks[20].date);assert.equal(r.themePersistence.windows[1].breadth.strictlyDeclining,true);}
 const bad={...state,bars:[...state.bars,{...f.sectors.at(-1),period:'daily',sector:'医药'}]};
 assert.equal(deriveCheckInput(bad,{code,date:day}).recognition.chaseRiskResearch.sectorPositionRisk,null);
 assert.equal(observations(bad,day,{code,all:true}).find(r=>r.date===day).features.chaseRiskResearch.sectorPositionRisk,null);
});
