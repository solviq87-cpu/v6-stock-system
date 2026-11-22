'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const catalog=require('../public/nova/shortline/catalog.json');
const dictionary=import('../public/nova/shortline/factor-dictionary.mjs');
const protocol=import('../public/nova/shortline/model-context.mjs');
const {proposeLocalModel}=require('../src/core/local-model-learning-proposer');
const iso='2026-11-20T07:30:00.000Z',at=Date.parse(iso);
const check={date:'2026-11-20',code:'600000',createdAt:iso,asOf:'2026-11-20 15:30',
  matches:[catalog[0].name],selected:['1:0','1:1','1:0','2:8'],factorCodes:['GG-01','ZZ-88','GG-01']};
test('新会话加载完整释义，后续只传代号；未知版本、映射冲突、坏序号均可安全恢复',async()=>{
  const {modelFrame,createModelContext}=await protocol,{factorDictionary,factorPacket}=await dictionary,d=factorDictionary(catalog);
  const p=factorPacket({catalog,checks:[check,{...check,asOf:'2026-11-20 15:31'}]},at);
  assert.equal(p.records.length,1);assert.ok(d.entries.every(e=>e.meaning&&e.name));assert.equal(d.entries.filter(e=>e.code.startsWith('YZ-')).length,95);
  const next=createModelContext(),first=modelFrame(p,d,next.ack()),summary=next.accept(first);
  assert.equal(first.mapping.length,d.entries.length);
  const partial=summary.find(r=>r.code==='YZ-01');assert.equal(partial.matched,1);assert.deepEqual(partial.conditions,[1,2]);
  assert.equal(next.explain('YZ-01',2),catalog[0].factors[1]);
  const later=modelFrame(p,d,next.ack());
  assert.ok(!Object.hasOwn(later,'mapping'));assert.ok(!JSON.stringify(later).includes(catalog[0].name));assert.deepEqual(next.accept(later),summary);
  assert.throws(()=>createModelContext().accept(later),/重传/);
  const bad={...first,mapping:first.mapping.map((e,i)=>i?e:{...e,name:'错误释义'})};
  assert.throws(()=>next.accept(bad),/冲突/);
  assert.throws(()=>next.accept({...later,records:[{...later.records[0],conditions:{'YZ-01':[999]}}]}),/越界/);
  assert.throws(()=>next.accept({...later,dictionary:'new-version'}),/重传/);
  const updated={...d,version:'new-version'},refresh=modelFrame({...p,dictionary:updated.version},updated,next.ack());
  assert.equal(refresh.mapping.length,d.entries.length);assert.deepEqual(next.accept(refresh),summary);assert.equal(next.ack(),updated.version);
});
test('普通复盘走同一压缩接收器，完整命中、单项条件和有据观测分别陈述并可跳词典',async()=>{
  const {buildReview}=await import('../public/nova/shortline/review.mjs');
  const c={...check,id:'c',strategy:catalog[0].name,observedAt:at};
  const state={market:[],bars:[],trades:[],notes:[],explanations:[],catalog,checks:[c]};
  const r=buildReview(state,{date:check.date});
  const group=r.groups.find(x=>x.title==='因子代号复核');
  assert.ok(group.lines.some(s=>s.includes('GG-01')&&s.includes('有据观测 1 次')));
  assert.ok(group.lines.some(s=>s.includes('YZ-01')&&s.includes('完整命中 1 次')&&s.includes('1、2')));
  assert.ok(Object.values(group.links).every(x=>x.page==='dictionary'&&x.factor===x.ref));
});
const digest='a'.repeat(64),model='shortline:tiny';
function sealed(){
  const ids=['TL-01','GG-05'],src={mode:'v6-factor-shadow-evolution-v1',status:'shadow-updated',canTrade:false,productionWeightsChanged:false,packFingerprint:'b'.repeat(64),lastObservationDay:'2026-11-19',factorIds:ids,factorLearning:Object.fromEntries(ids.map(id=>[id,{reliable:true,suggestedWeightMultiplier:.03}])),secret:'private-sample-600000'};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(src)).digest('hex');
  return {source:{...src,fingerprint},definitions:ids.map(id=>({id,baseWeight:1})),acceptedWeights:Object.fromEntries(ids.map(id=>[id,1])),packFingerprint:src.packFingerprint,latestFrozenDay:'2026-11-20'};
}
async function mock(t,supportsContext=true){
  const calls=[],tokens=[25,427,563],answer=JSON.stringify({candidateWeights:{'TL-01':1.02,'GG-05':1.03},rationale:'封存样本内候选'});
  const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const p=body?JSON.parse(body):{};calls.push({path:req.url,p});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:model,digest}]}));
    if(req.url==='/api/generate'&&!p.context)return res.end(JSON.stringify({model,done:true,response:'OK',...(supportsContext?{context:tokens}:{})}));
    if(req.url==='/api/generate')return res.end(JSON.stringify({model,done:true,response:answer,context:[1,2,3,4]}));
    return res.end(JSON.stringify({model,done:true,message:{role:'assistant',content:answer}}));
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  return {calls,options:{model,digest,endpoint:'http://127.0.0.1:'+server.address().port}};
}
test('本机 Ollama 首次只预载公共释义，再次仅发密封汇总和代号，复用的上下文不含样本',async t=>{
  const {calls,options}=await mock(t),input=sealed();
  for(let i=0;i<2;i++)assert.equal((await proposeLocalModel(input,options)).productionWeightsChanged,false);
  const frames=calls.filter(r=>r.path==='/api/generate').map(r=>r.p);
  assert.equal(frames.length,3);assert.match(frames[0].prompt,/龙头溢价差因子/);
  assert.ok(!frames[0].prompt.includes('acceptedWeight'));
  for(const p of frames.slice(1)){assert.deepEqual(p.context,[25,427,563]);assert.ok(!p.prompt.includes('龙头溢价差因子'));assert.ok(p.prompt.includes('TL-01'));}
  assert.ok(!JSON.stringify(calls).includes('private-sample'));
});
test('不返回上下文的本机模型每个新会话使用独立词典，未知代号不会向模型发出',async t=>{
  const {calls,options}=await mock(t,false),input=sealed();
  assert.ok((await proposeLocalModel(input,options)).candidateWeights['GG-05']>1);
  const body=JSON.parse(calls.find(r=>r.path==='/api/chat').p.messages[1].content);
  assert.equal(body.mapping.length,2);assert.ok(body.mapping.every(e=>e.meaning));
  const count=calls.length;input.definitions[0].id='ZZ-22';await assert.rejects(()=>proposeLocalModel(input,options));assert.equal(calls.length,count);
});
