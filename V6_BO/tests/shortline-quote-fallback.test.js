'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createShortlineQuoteFallback}=require('../src/research/shortline-quote-fallback');
const day='2026-11-20', now=Date.parse('2026-11-22T14:00+08:00');
const clock=()=>now;
const wrap=value=>({status:200,headers:{},raw:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
const stock={secid:'1.600000',day};
const board={secid:'90.BK0475',name:'银行Ⅱ',day};
const reference={date:day,code:'600000',name:'浦发银行',priceBasis:'unadjusted',source:'V6/eastmoney',knownAt:now,open:10,high:11,low:9,close:10};
function fixtures(step=1) {
  const out=[];
  for(const start of [570,780]) {
    for(let n=start+step;n<=start+120;n+=step) {
      const at=day+' '+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
      out.push([at,'10','10','11','9','10','10000']);
    }
  }
  return out;
}
const emMinutes=(series,market=1,code='600000',name='浦发银行')=>({rc:0,data:{name,code,market,trends:series.map(r=>r.join(','))}});
const mk=(key,code,name,field,rows)=>({code:0,data:{[key]:{qt:{[key]:['1',name,code]},[field]:rows}}});
function rawDays(){
  const days=[];
  for(let i=45;i>=0;i--){
    const d=new Date(Date.parse(day)-i*86400000),dow=d.getUTCDay();
    if(dow!==0&&dow!==6)days.push([d.toISOString().slice(0,10),'10','10','11','9','10','10000']);
  }
  return days;
}
function reader(responder) {
  const calls=[];
  const api=createShortlineQuoteFallback({clock,request:async u=>{
    const url=new URL(u);calls.push(url);return wrap(await responder(url));
  }});
  return {api,calls};
}
test('three indices are keyed by market and verified provider name; preserve first receipt rather than exchange close',async()=>{
  const symbols=[['1.000985','sh000985','中证全指'],['1.000001','sh000001','上证综指'],['0.399006','sz399006','创业板指']];
  for(const [secid,key,name] of symbols){
    const {api,calls}=reader(()=>mk(key,key.slice(2),name,'day',rawDays()));
    const r=await api.readIndex({secid,day});
    assert.equal(r.name,name);assert.equal(r.src,'V6/tencent');assert.equal(r.receivedAt,now);
    assert.equal(r.rows.at(-1).date,day);assert.equal(r.rows.at(-1).volume,10);
    assert.equal(r.priceBasis,'unadjusted');assert.match(r.rawHash,/^[0-9a-f]{64}$/);
    assert.equal(calls[0].searchParams.get('param'),key+',day,,'+day+',120,');
  }
});
test('wrong Shanghai equity, absence of quote identity, adjusted-only and stale Tencent windows trigger a verified unadjusted Eastmoney retry',async()=>{
  for(const first of [
    mk('sh000001','000001','平安银行','day',rawDays()),
    {code:0,data:{sh000001:{day:rawDays()}}},
    mk('sh000001','000001','上证指数','qfqday',rawDays()),
    mk('sh000001','000001','上证指数','day',rawDays().slice(0,-1))
  ]){
    const {api,calls}=reader(u=>u.hostname.includes('gtimg')?first:
      {rc:0,data:{market:1,code:'000001',name:'上证指数',klines:rawDays().map(r=>r.join(','))}});
    const r=await api.readIndex({secid:'1.000001',day});
    assert.equal(r.src,'V6/eastmoney');assert.equal(r.attempts[0].status,'unavailable');
    assert.equal(calls[1].searchParams.get('fqt'),'0');assert.equal(calls[1].searchParams.get('end'),'20261120');
  }
});
test('daily input excludes future market rows; daily close unfinished in Beijing never calls the provider',async()=>{
  const rows=rawDays().concat([['2026-11-23','999','999','999','999','999']]);
  const {api}=reader(()=>mk('sh000985','000985','中证全指','day',rows));
  const r=await api.readIndex({secid:'1.000985',day});assert.equal(r.rows.at(-1).date,day);
  const beforeClose=createShortlineQuoteFallback({clock:()=>Date.parse(day+'T15:09:59+08:00'),request:()=>assert.fail('unfinished daily bar fetch')});
  assert.deepEqual((await beforeClose.readIntraday(stock)).bars,[]);
  assert.deepEqual((await beforeClose.readIndex({secid:'1.000985',day})).rows,[]);
});
test('actual 1m OHLC retained, auction excluded, stock lots converted to shares; availability is receipt time',async()=>{
  const rows=fixtures(),anchor=[day+' 09:30','10','10','10','10','2','2000'];
  const {api}=reader(()=>emMinutes([anchor,...rows]));
  const r=await api.readIntraday({...stock,reference});
  assert.equal(r.bars.length,240);assert.equal(r.period,'1m');assert.equal(r.rows[0].open,10);
  assert.equal(r.rows[0].volume,1000);assert.equal(r.rows[0].amount,10000);assert.equal(r.rows[0].volumeUnit,'shares');
  assert.equal(r.rows[0].availableAt,'2026-11-22 14:00');assert.equal(r.rows[0].knownAt,now);
  assert.equal(r.rows[0].date,day+' 09:31');assert.equal(r.rows.at(-1).date,day+' 15:00');
  assert.equal(r.rows[0].sessionOpen,true);assert.equal(r.rows.at(-1).sessionClose,true);
});
test('Tencent supplies fallback real 1-minute stock and index OHLCV without mislabelling volume units',async()=>{
  const minute=fixtures(1).map(([t,...r])=>[t.replace(/[- :]/g,''),...r.slice(0,5),{},'1.00']);
  for(const [secid,key,name,expectedVolume] of [['1.600000','sh600000','浦发银行',1000],['1.000985','sh000985','中证全指',10]]){
    const {api}=reader(u=>u.hostname.includes('gtimg')?mk(key,key.slice(2),name,'m1',minute):{});
    const result=await api.readIntraday({secid,day});
    assert.equal(result.bars.length,240);assert.equal(result.period,'1m');
    assert.equal(result.bars[0].volume,expectedVolume);assert.equal(result.bars[0].source,'V6/tencent');
    assert.equal(result.bars[0].amount,undefined);
  }
});
test('broken one-minute feed uses actual Tencent 5-minute bars; no fabricated one-minute bars/amount',async()=>{
  const minute=fixtures(5).map(([t,...r])=>[t.replace(/[- :]/g,''),...r.slice(0,5),{},'1.00']);
  const {api,calls}=reader(u=>u.hostname.includes('gtimg')?mk('sh600000','600000','浦发银行','m5',minute):emMinutes(fixtures().slice(0,-1)));
  const result=await api.readIntraday(stock);
  assert.equal(calls.length,4);assert.equal(result.bars.length,48);assert.equal(result.period,'5m');
  assert.equal(result.bars[0].volume,1000);assert.equal(result.bars[0].amount,undefined);
  assert.equal(result.bars[0].date,day+' 09:35');assert.equal(result.bars[0].source,'V6/tencent');
});
test('Sina request-bound JSONP is admitted only with independent raw same-date OHLC corroboration',async()=>{
  const series=fixtures(5).map(([at])=>({day:at+':00',open:'10',close:'10',high:'11',low:'9',volume:'1000',amount:'10000'}));
  function response(u){return u.hostname.includes('sina')?'/* observed JSONP */\nvar series=('+JSON.stringify(series)+');':{};}
  const {api}=reader(response);
  const good=await api.readIntraday({...stock,reference});
  assert.equal(good.src,'V6/sina');assert.equal(good.rows.length,48);assert.equal(good.rows[0].volume,1000);
  for(const ref of [undefined,{...reference,source:'sina'},{...reference,high:15},{...reference,priceBasis:'qfq'},{...reference,knownAt:now+90000}]){
    const result=await api.readIntraday({...stock,reference:ref});assert.deepEqual(result.bars,[]);
  }
});
test('board uses only its own dated market/name; vendor aggregate volume does not become share volume',async()=>{
  const data=emMinutes(fixtures(),90,'BK0475','银行Ⅱ'),{api,calls}=reader(()=>data);
  const r=await api.readIntraday(board);assert.equal(r.bars.length,240);
  assert.equal(r.bars[0].role,'sector');assert.equal(r.bars[0].sector,'银行Ⅱ');assert.equal(r.bars[0].volume,10);
  assert.equal(r.bars[0].volumeUnit,'eastmoney-index-volume');
  const mismatch=await api.readIntraday({...board,name:'错误板块'});assert.deepEqual(mismatch.bars,[]);
  assert.ok(calls.every(u=>u.hostname.endsWith('eastmoney.com')));
});
test('wrong stock identity, bad share/amount scale, missing interval, duplicate, future-only and fabricated flat-close rows are unavailable',async()=>{
  const series=fixtures();
  for(const rejected of [emMinutes(series,0),emMinutes(series.map(r=>[...r.slice(0,6),'10'])),
    emMinutes(series.slice(1)),emMinutes([...series.slice(1),series.at(-1)]),emMinutes(series.map(r=>[r[0].replace(day,'2026-11-23'),...r.slice(1)])),emMinutes(series.map(r=>[r[0],r[2]]))]){
    const {api}=reader(()=>rejected);
    assert.deepEqual((await api.readIntraday(stock)).bars,[]);
  }
});
