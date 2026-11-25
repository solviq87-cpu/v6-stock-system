'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDecisionSectorContext,projectSectors}=require('../src/core/decision-sector-context');
const now=Date.parse('2026-11-25T10:00:00+08:00');
const row=(i=1,day='2026-11-25')=>({code:'BK'+String(i).padStart(4,'0'),name:'板块'+i,mainInflow:i*1000000,
 source:'eastmoney',upstream:'eastmoney',fundsUnit:'CNY',fundsMethod:'vendor-order-size-estimate',
 retrievedAt:Date.parse(day+'T09:59:00+08:00'),sourceTimestamp:null,tradeDate:null});
function setup(t){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-context-')),root=path.join(parent,'archive');
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));return {root,parent};
}
test('formal mainInflow fields retain CNY, original unknown time and the full board list beyond the first twenty',()=>{
 const rows=Array.from({length:30},(_,i)=>row(i+1));
 const result=projectSectors({day:'20261125',rows,ind:[rows[25]]},{day:'2026-11-25',now});
 assert.equal(result.rows.length,30);assert.equal(result.rows[25].mainInflow,26000000);
 assert.equal(result.rows[25].category,'industry');assert.equal(result.rows[25].sourceTimestamp,null);
 assert.equal(result.rows[25].snapshotDay,'2026-11-25');assert.equal(result.rows[25].tradeDate,null);
 assert.match(result.rows[25].dateBasis,/未提供/);assert.equal(result.unknownSourceTime,30);
});
test('selected historical date never borrows today and reads do not create a directory or write data',t=>{
 const {root}=setup(t),reader=createDecisionSectorContext({root,clock:()=>now,readCurrent:()=>({day:'20261125',rows:[row()]})});
 const result=reader.read('2026-11-24');assert.equal(result.rows.length,0);assert.match(result.missing[0],/2026-11-24/);
 assert.equal(fs.existsSync(root),false);assert.equal(reader.read('2026-11-25').rows.length,1);
 assert.equal(fs.existsSync(root),false);assert.throws(()=>reader.read('2026-11-26'));
});
test('a retained complete original snapshot supports an older decision day after restart',t=>{
 const {root}=setup(t),prior={day:'20261124',rows:[row(1,'2026-11-24')]};
 const writer=createDecisionSectorContext({root,clock:()=>now,canWrite:()=>true});
 assert.equal(writer.capture(prior).saved,true);assert.equal(writer.capture(prior).saved,false);
 const reader=createDecisionSectorContext({root,clock:()=>now,readCurrent:()=>({day:'20261125',rows:[row(2)]})});
 const before=fs.readFileSync(path.join(root,'2026-11-24.json'),'utf8'),result=reader.read('2026-11-24');
 assert.equal(result.rows[0].code,'BK0001');assert.equal(result.rows[0].retrievedAt,prior.rows[0].retrievedAt);
 assert.equal(fs.readFileSync(path.join(root,'2026-11-24.json'),'utf8'),before);
});
test('missing units, future receipts, contradictory dates and same-time conflicts are excluded without becoming zero',()=>{
 const list=[row(1),{...row(2),fundsUnit:'USD'},{...row(3),retrievedAt:now+1},{...row(4),tradeDate:'2026-11-24'},
  row(5),{...row(5),mainInflow:8}, {...row(6),mainInflow:null}];
 const result=projectSectors({day:'20261125',rows:list},{day:'2026-11-25',now});
 assert.deepEqual(result.rows.map(r=>r.code),['BK0001','BK0006']);assert.equal(result.rows[1].mainInflow,null);
 assert.equal(result.rejected,4);
});
test('damaged historical records and symlinked archives are refused rather than silently replaced',t=>{
 const {root,parent}=setup(t),writer=createDecisionSectorContext({root,clock:()=>now,canWrite:()=>true});
 const snapshot={day:'20261125',rows:[row()]};writer.capture(snapshot);
 const file=path.join(root,'2026-11-25.json'),bad=JSON.parse(fs.readFileSync(file,'utf8'));bad.rows[0].mainInflow=999;
 fs.writeFileSync(file,JSON.stringify(bad));assert.throws(()=>writer.read('2026-11-25'),/校验失败/);assert.throws(()=>writer.capture(snapshot),/损坏/);
 const link=path.join(parent,'linked');fs.symlinkSync(root,link,'dir');assert.throws(()=>createDecisionSectorContext({root:link}),/符号链接/);
});
test('replica capture is a no-op and private fields cannot leak into market rows',t=>{
 const {root}=setup(t),reader=createDecisionSectorContext({root,clock:()=>now,canWrite:()=>false,
  readCurrent:()=>({day:'20261125',rows:[{...row(),token:'private',account:{cash:9}}]})});
 assert.equal(reader.capture({day:'20261125',rows:[row()]}).saved,false);assert.equal(fs.existsSync(root),false);
 const result=reader.read('2026-11-25').rows[0];assert.equal(result.token,undefined);assert.equal(result.account,undefined);
});
