'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {saveMinuteBars,readMinuteBars}=require('../src/research/shortline-minute-archive');
const day='2026-11-19',code='600001';
const millis=(day,time)=>Date.parse(day+'T'+time+':00+08:00');
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shortline-minute-test-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return root;
}
function sample(day,code,role='stock',period='1m'){
  const slots=period==='5m'?48:240,step=period==='5m'?5:1;
  return Array.from({length:slots},(_,i)=>{
    const n=i<slots/2?570+(i+1)*step:780+(i+1-slots/2)*step;
    const hh=String(Math.floor(n/60)).padStart(2,'0'),mm=String(n%60).padStart(2,'0');
    return {date:day+' '+hh+':'+mm,code,role,period,...(role==='sector'?{sector:'测试行业'}:{}),
      open:10,high:11,low:9,close:10,volume:4300,amount:43000,knownAt:millis(day,'15:16'),availableAt:day+' 15:16',source:'V6/eastmoney'};
  });
}
function capture(day,code,time='16:00'){
  return {code,day,observedAtMs:millis(day,time),observedAt:day+' '+time,latestClosedDay:day,latestClosed:false,stock:{code,name:'合成'},name:'合成',bars:[],market:[],missing:[],evidence:[]};
}
test('one-session compressed shards preserve first price/receipt and share the sector file across equities',t=>{
  const root=setup(t),s=capture(day,code),stock=sample(day,code),sector=sample(day,'BK0475','sector'),rows=[...stock,...sector];
  assert.equal(saveMinuteBars(root,s,rows).added,480);
  const dir=path.join(root,'minutes-v1',day),file=path.join(dir,'sector-BK0475-1m.json.gz'),bytes=fs.readFileSync(file),stat=fs.statSync(file);
  assert.equal(stat.mode&0o777,0o600);assert.equal(fs.statSync(dir).mode&0o777,0o700);
  assert.ok(bytes.length<Buffer.byteLength(JSON.stringify(sector))/4);
  const later=capture(day,code,'16:30'),late=rows.map(r=>({...r,source:'V6/tencent',knownAt:later.observedAtMs,availableAt:later.observedAt}));
  assert.deepEqual(saveMinuteBars(root,later,late),{added:0,confirmed:480,conflicts:0});
  assert.equal(saveMinuteBars(root,later,[{...late[0],close:10.4}]).conflicts,1);
  assert.equal(saveMinuteBars(root,capture(day,'600002','17:00'),[...sector,...sample(day,'600002')]).added,240);
  assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.statSync(file).ino,stat.ino);
  const read=readMinuteBars(root,later),first=read.find(b=>b.role==='stock');
  assert.equal(read.length,480);assert.equal(first.close,10);assert.equal(first.knownAt,stock[0].knownAt);assert.equal(first.source,'V6/eastmoney');
  assert.equal(read.find(b=>b.role==='sector').membershipKnownAt,s.observedAtMs);
  assert.equal(readMinuteBars(root,capture(day,'600002','16:01')).length,0);
  assert.equal(readMinuteBars(root,capture('2026-11-20',code)).length,0);
  assert.equal(readMinuteBars(root,capture(day,'600002','17:01')).length,480);
});
test('period keys are distinct, unsafe paths, incomplete clocks and corrupt files fail closed',t=>{
  const root=setup(t),s=capture(day,code),one=sample(day,code),five=sample(day,code,'stock','5m');
  assert.equal(saveMinuteBars(root,s,[...one,...five]).added,288);
  assert.throws(()=>saveMinuteBars(root,s,[{...one[0],knownAt:null}]));
  assert.throws(()=>saveMinuteBars(root,s,[{...one[0],code:'../outside'}]));
  assert.throws(()=>saveMinuteBars(root,s,[{...one[0],date:'2026-11-20 09:31'}]));
  const f=path.join(root,'minutes-v1',day,'stock-'+code+'-5m.json.gz');
  fs.writeFileSync(f,'broken');
  assert.throws(()=>readMinuteBars(root,s));assert.throws(()=>saveMinuteBars(root,s,five));
  assert.equal(fs.readFileSync(f,'utf8'),'broken');
  fs.unlinkSync(f);fs.symlinkSync(path.join(root,'unrelated'),f);
  assert.throws(()=>saveMinuteBars(root,s,five));
});
test('normal authenticated research sync projects current minutes and reopens older target/day without a provider minute feed',async t=>{
  const dir=setup(t),root=path.join(dir,'archive'),saved=process.env.V6_ORDER_ACCOUNTS_DIR;
  process.env.V6_ORDER_ACCOUNTS_DIR=path.join(dir,'synthetic-no-account');
  t.after(()=>{if(saved==null)delete process.env.V6_ORDER_ACCOUNTS_DIR;else process.env.V6_ORDER_ACCOUNTS_DIR=saved;});
  const {shortlineJob}=await import('../src/research/shortline/store.mjs');
  let revision=0;
  async function sync(snapshot){
    const result=await shortlineJob({root,input:{revision,action:'v6:sync',payload:{code:snapshot.code,day:snapshot.day}},snapshot});
    revision=result.state.revision;return result;
  }
  const s=capture(day,code),bars=[...sample(day,code),...sample(day,'BK0475','sector')];
  const daily={date:day,code,period:'日K',role:'stock',open:10,high:11,low:9,close:10,volume:500,
    source:'V6/eastmoney',knownAt:s.observedAtMs,availableAt:s.observedAt};
  let out=await sync({...s,bars:[daily,...bars]});
  assert.equal(out.state.bars.length,1);assert.equal(out.state.v6Observation.minuteBars.length,480);
  assert.equal(out.result.minuteReport.added,480);assert.ok(!JSON.stringify(out.result).includes('minuteBars'));
  const reread=await shortlineJob({root});assert.deepEqual(reread.state.v6Observation.minuteBars,out.state.v6Observation.minuteBars);
  out=await sync({...s,minuteBars:bars});assert.equal(out.result.minuteReport.confirmed,480);
  const n=capture('2026-11-20','600002');out=await sync({...n,minuteBars:sample(n.day,n.code)});
  assert.equal(out.state.v6Observation.minuteBars.length,240);
  out=await sync(s);assert.equal(out.state.v6Observation.minuteBars.length,480);
  assert.ok(out.state.v6Observation.minuteBars.every(b=>b.date.startsWith(day)));
  const archive=JSON.parse(fs.readFileSync(path.join(root,'research.json'))).state;
  assert.ok(!Object.hasOwn(archive.v6Observation,'minuteBars'));assert.deepEqual(archive.bars,[daily]);
});
