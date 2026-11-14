'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {validate,projectEcbCsv,collectEcbFxRate,parseCsv}=require('../src/core/ecb-fx-daily');
const now=Date.parse('2026-11-14T12:00:00Z');
const cfg={currency:'USD',start:'2026-11-02',end:'2026-11-06',now};
const header='KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
const line=(date,value,extra='')=>'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,'+date+','+value+','+extra;
const csv=lines=>header+'\r\n'+lines.join('\r\n')+'\r\n';
const response=body=>{
 const data=Buffer.from(body);
 return {ok:true,status:200,headers:{get:k=>k==='content-type'?'text/csv; charset=utf-8':null},
  body:Readable.from([data])};
};
test('ECB daily USD per EUR exact key, one GET, units and null gap retained',async()=>{
 let requests=0;
 const result=await collectEcbFxRate({...cfg,fetchImpl:async(url,options)=>{
  requests++;
  const target=new URL(url);
  assert.equal(target.origin,'https://data-api.ecb.europa.eu');
  assert.equal(target.pathname,'/service/data/EXR/D.USD.EUR.SP00.A');
  assert.equal(target.searchParams.get('format'),'csvdata');
  assert.equal(target.searchParams.get('startPeriod'),'2026-11-02');
  assert.equal(target.searchParams.get('endPeriod'),'2026-11-06');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return response(csv([line('2026-11-02','1.1200','A'),line('2026-11-03','','M'),line('2026-11-06','1.13','A')]));
 }});
 assert.equal(requests,1);
 assert.equal(result.provider,'ecb');assert.equal(result.direction,'USD per 1 EUR');
 assert.deepEqual(result.rows.map(x=>x.unitsPerEuro),[1.12,null,1.13]);
 assert.equal(result.rows[0].providerPublishedAt,null);
 assert.equal(result.rows[0].quoteAt,null);
 assert.equal(result.publicationTimeVerified,false);
 assert.equal(result.verifiedLive,false);assert.equal(result.canTrade,false);
});
test('ECB quoted CSV fields, CRLF and unknown attributes remain parseable',()=>{
 const rows=parseCsv('KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_COM\r\n'+
  '"EXR.D.USD.EUR.SP00.A",D,2026-11-02,1.12,"Vendor, reference"\r\n');
 assert.equal(rows.length,2);
 assert.equal(rows[1][0],'EXR.D.USD.EUR.SP00.A');
 assert.equal(rows[1][4],'Vendor, reference');
});
test('wrong series, wrong unit/denominator or duplicate observation must fail closed',()=>{
 for(const incorrect of [
  line('2026-11-02','1.12').replace('EXR.D.USD','EXR.D.GBP'),
  line('2026-11-02','1.12').replace(',USD,EUR',',USD,USD'),
  line('2026-11-02','1.12').replace(',SP00,A',',SP01,A'),
  line('2026-11-02','1.12').replace('2026-11-02','2026-11-07'),
  line('2026-11-02','1.12').replace('2026-11-02','2026-02-30')
 ])assert.throws(()=>projectEcbCsv(csv([incorrect]),{...cfg,observedAt:now}));
 assert.throws(()=>projectEcbCsv(csv([line('2026-11-02','1.2'),line('2026-11-02','1.2')]),{...cfg,observedAt:now}),/不一致/);
});
test('zero, NaN, Infinity and hidden numeric coercion cannot become market rates',()=>{
 for(const value of ['0','-2','NaN','Infinity','0x12','1e3',' 1.2','1,2']){
  const text=csv([line('2026-11-02',value)]);
  assert.throws(()=>projectEcbCsv(text,{...cfg,observedAt:now}),value);
 }
 assert.throws(()=>projectEcbCsv(csv([line('2026-11-02','')]),{...cfg,observedAt:now}),/没有有效汇率/);
});
test('empty/duplicate/malformed headers, unsafe query and oversized responses are rejected',async()=>{
 assert.throws(()=>projectEcbCsv('KEY,KEY,TIME_PERIOD,OBS_VALUE\r\nx,x,2026-11-02,1.1',{...cfg,observedAt:now}));
 const opts=[{...cfg,currency:'../../bad'}, {...cfg,currency:'EUR'},
  {...cfg,start:'2026-01-01',end:'2026-12-31'},
  {...cfg,start:'2026-11-09',end:'2026-11-02'},
  {...cfg,end:'2027-01-01'}, {...cfg,timeoutMs:50}];
 let calls=0;
 for(const opt of opts)await assert.rejects(()=>collectEcbFxRate({...opt,fetchImpl:async()=>{calls++;return response(csv([line('2026-11-02','1.2')]));}}),/无效/);
 assert.equal(calls,0);
 await assert.rejects(()=>collectEcbFxRate({...cfg,fetchImpl:async()=>({ok:false,status:429})}),/429/);
 await assert.rejects(()=>collectEcbFxRate({...cfg,fetchImpl:async()=>({
  ok:true,headers:{get:()=> 'application/json'},text:async()=> '{}'
 })}),/不是CSV/);
 await assert.rejects(()=>collectEcbFxRate({...cfg,fetchImpl:async()=>({
  ok:true,headers:{get:()=> 'text/csv'},body:Readable.from([Buffer.alloc(513*1024)])
 })}),/超过512KiB/);
});
