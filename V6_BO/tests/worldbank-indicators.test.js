'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {collectWorldBankIndicator,parseWorldBankResponse}=require('../src/core/worldbank-indicators');
const now=Date.parse('2026-11-14T16:00:00+08:00');
const cfg={country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2023,endYear:2025,now};
function body(rows){
 return [{page:1,pages:1,per_page:'100',total:rows.length},rows.map(([date,value])=>({
  date,countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD',value:'GDP'},value
 }))];
}
const response=payload=>{
 const b=Buffer.from(JSON.stringify(payload));
 return {ok:true,headers:{get:()=> 'application/json'},body:Readable.from([b])};
};
test('official API uses exact host, bounded annual range and one explicit read',async()=>{
 let calls=0;
 const result=await collectWorldBankIndicator({...cfg,fetchImpl:async(url,options)=>{
  calls++;
  assert.equal(new URL(url).hostname,'api.worldbank.org');
  assert.equal(new URL(url).pathname,'/v2/country/CHN/indicator/NY.GDP.MKTP.CD');
  assert.equal(new URL(url).searchParams.get('date'),'2023:2025');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return response(body([['2023',0],['2024',null],['2025',20]]));
 }});
 assert.equal(calls,1);
 assert.deepEqual(result.rows.map(x=>x.value),[0,null,20]);
 assert.equal(result.rows[0].providerPublishedAt,null);
 assert.equal(result.publicationVintageVerified,false);
 assert.equal(result.sourceRevisionKnown,false);
 assert.equal(result.canTrade,false);assert.equal(result.verifiedLive,false);
});
test('future, wrong country, missing row year, duplicates and nonnumbers are refused',()=>{
 for(const row of [
  {date:'2024',countryiso3code:'USA',indicator:{id:'NY.GDP.MKTP.CD'},value:1},
  {date:'2024',countryiso3code:'CHN',indicator:{id:'OTHER'},value:1},
  {date:'2030',countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},value:1},
  {date:'2024',countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},value:'0'},
  {date:'2024',countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},value:NaN}
 ])assert.throws(()=>parseWorldBankResponse([{pages:1},[row]],{...cfg,observedAt:now}));
 assert.throws(()=>parseWorldBankResponse(body([['2024',1],['2024',2]]),{...cfg,observedAt:now}),/重复|异常/);
});
test('invalid or future time range is blocked before any network call',async()=>{
 let calls=0;const mock=async()=>{calls++;throw Error('must not fetch');};
 for(const config of [{...cfg,country:'../../etc'},{...cfg,indicator:'_SYS'},{...cfg,endYear:2029},
  {...cfg,startYear:1990,endYear:2025},{...cfg,now:NaN}]){
  await assert.rejects(()=>collectWorldBankIndicator({...config,fetchImpl:mock}),/不合法/);
 }
 assert.equal(calls,0);
});
test('partial/paginated or inflated World Bank responses are not accepted',async()=>{
 const run=payload=>collectWorldBankIndicator({...cfg,fetchImpl:async()=>response(payload)});
 await assert.rejects(()=>run([{pages:2},[]]),/分页/);
 await assert.rejects(()=>run(body([['2023',1],['2024',2],['2025',3],['2026',4]])),/分页/);
});
