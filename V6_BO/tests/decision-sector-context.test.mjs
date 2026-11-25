import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectSectorFlows,projectDecisionSectors,decisionSectorReader} from '../public/nova/decision-sector-context.mjs';

const day='2026-11-16',now=Date.parse(day+'T14:00:00+08:00');
const row=(name='银行',overrides={})=>({code:name==='银行'?'BK0475':'BK1034',name,mainInflow:126000000,pct:1.2,
 source:'eastmoney',upstream:'eastmoney',fundsUnit:'CNY',unit:'CNY',fundsMethod:'vendor-order-size-estimate',
 retrievedAt:now-1000,sourceTimestamp:null,tradeDate:null,...overrides});
const state=(rows=[row()],date=day)=>({sectors:rows,sectorsDay:date.replaceAll('-','')});
const selection=(name='银行',date=day,code='600001')=>({code,day:date,row:{name:'原候选',sector:name},plan:{stop:9}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('the actual sector parser mainInflow/CNY/receipt contract is projected without inventing an upstream clock',async()=>{
 const source=fs.readFileSync(new URL('../em.js',import.meta.url),'utf8');
 const start=source.indexOf('function observedFlowNumber('),end=source.indexOf('// 板块成分股（',start);
 assert.ok(start>0&&end>start);
 const sandbox={EM:'https://upstream.invalid',Date:{now:()=>now-1000},get:async()=>({data:{diff:[
  {f12:'BK0475',f14:'银行',f62:126000000,f3:1.2,f104:7,f105:3}
 ]}})};
 vm.runInNewContext(source.slice(start,end)+';this.read=fetchSectorFlow;',sandbox);
 const original=await sandbox.read(2),before=JSON.stringify(original);
 const result=projectSectorFlows(state(original),{day,now});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].value,126000000);
 assert.equal(result.rows[0].source,'eastmoney');assert.equal(result.rows[0].day,day);
 assert.equal(result.rows[0].sourceTimestamp,null);assert.equal(result.rows[0].retrievedAt,now-1000);
 assert.equal(JSON.stringify(original),before,'the source row is never rewritten into another date or unit');
});

test('unknown unit/source, conflicting days and fields, future evidence and ambiguous duplicates stay missing',()=>{
 for(const invalid of [row('银行',{fundsUnit:null,unit:null}),row('银行',{source:'unknown',upstream:'unknown'}),
  row('银行',{fundsMethod:null}),row('银行',{retrievedAt:now+1}),row('银行',{sourceTimestamp:now+1}),
  row('银行',{tradeDate:'2026-11-13'}),row('银行',{mainInflowYuan:1}),row('银行',{mainInflow:null})]){
  const result=projectSectorFlows(state([invalid]),{day,now});assert.equal(result.rows.length,0);assert.ok(result.rejected.length);
 }
 for(const input of [{...state(),snapshotFieldDays:{sectors:'20261113'}},{...state(),sectorsDay:''},state([row()],'2026-11-13')])
  assert.equal(projectSectorFlows(input,{day,now}).rows.length,0);
 assert.equal(projectSectorFlows(state([row(),row('银行',{mainInflow:1}),row()]),{day,now}).rows.length,0);
 assert.equal(projectSectorFlows(state([row('银行',{mainInflow:0})]),{day,now}).rows[0].value,0,'an observed zero is retained');
});

test('a selected stock filters the full same-day response while old/current day data cannot substitute for one another',()=>{
 const full={ok:true,day,sectorsDay:day,rows:[row('银行'),row('芯片')],missing:['源端资金时刻未提供']};
 const original=JSON.stringify(full);
 const bank=projectDecisionSectors(selection(),state([row('芯片')]),full,{now});
 assert.deepEqual(bank.rows.map(r=>r.name),['银行']);assert.equal(bank.complete,true);
 const chip=projectDecisionSectors(selection('芯片',day,'600002'),state(),full,{now});
 assert.deepEqual(chip.rows.map(r=>r.name),['芯片']);
 const old=projectDecisionSectors(selection('银行','2026-11-13'),state(),null,{now});
 assert.equal(old.rows.length,0);assert.match(old.missing.join(' '),/不同日/);
 const missing=projectDecisionSectors(selection('银行','2026-11-13'),state(),
  {ok:true,day:'2026-11-13',sectorsDay:null,rows:[],missing:['未留存该日有来源的板块资金']},{now});
 assert.equal(missing.rows.length,0);assert.match(missing.missing.join(' '),/未留存/);
 assert.equal(JSON.stringify(full),original);
});

test('lazy shared reads reject late previous-day replies and never restore data after abort',async t=>{
 t.mock.method(Date,'now',()=>now);
 const pending=[],decisions=[],states=[],controller=new AbortController();
 const ctx={state:state(),decisionSelection:null,signal:controller.signal,
  onDecisionSelection:fn=>decisions.push(fn),onState:fn=>states.push(fn),
  api:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))};
 const reader=decisionSectorReader(ctx);assert.equal(decisionSectorReader(ctx),reader);
 let changes=0;reader.subscribe(()=>changes++);states.forEach(fn=>fn());await tick();assert.equal(pending.length,0);
 ctx.decisionSelection=selection();reader.read();reader.read();await tick();assert.equal(pending.length,1);
 ctx.decisionSelection=selection('银行','2026-11-13');decisions.forEach(fn=>fn());reader.read();await tick();assert.equal(pending.length,2);
 const afterSelection=changes;
 pending[0].resolve({ok:true,day,sectorsDay:day,rows:[row()]});await tick();
 assert.equal(changes,afterSelection,'late day response cannot repaint the selected history');
 assert.equal(reader.read().rows.length,0);
 pending[1].resolve({ok:true,day:'2026-11-13',sectorsDay:'2026-11-13',rows:[row('银行',{retrievedAt:now-1000})]});await tick();
 assert.equal(reader.read().rows[0].day,'2026-11-13');
 ctx.decisionSelection=selection('芯片',day,'600002');decisions.forEach(fn=>fn());
 assert.equal(reader.read().rows.length,0,'a cached bank response does not become another stock’s funds');
 controller.abort();const aborted=changes;states.forEach(fn=>fn());await tick();assert.equal(changes,aborted);
 assert.ok(pending.every(r=>r.options.signal===controller.signal&&!r.options.method));
});

test('a mismatched response day is not accepted as the requested archive',async t=>{
 t.mock.method(Date,'now',()=>now);const controller=new AbortController();
 const ctx={state:{},decisionSelection:selection(),signal:controller.signal,
  api:async()=>({ok:true,day:'2026-11-13',sectorsDay:day,rows:[row()]})};
 const reader=decisionSectorReader(ctx);reader.read();await tick();
 assert.equal(reader.read().rows.length,0);assert.match(reader.read().missing.join(' '),/回执暂不可用/);
 controller.abort();
});
