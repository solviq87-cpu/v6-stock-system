'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV6MatchesSnapshotStore}=require('../src/core/v6-matches-snapshot');

const mk=(n)=>Array.from({length:n},(_,i)=>({
  code:String(100000+i).padStart(6,'0'), name:'标的'+i,sector:'测试板块',
  price:10+i/100,pct:1,score:40,hit:[{id:'1',text:'真实返回条件一'},{id:'2',text:'真实返回条件二'}]
}));

test('all 250 matching stocks and every hit remain accessible through pinned read-only pages',()=>{
  const store=createV6MatchesSnapshotStore();
  assert.equal(store.page().status,'not-ready');
  const input=mk(250),p=store.publish({items:input,asOf:1794299400000,totalScanned:5300,board:'all'});
  assert.equal(p.ok,true);
  let cursor='',codes=[],count=0,firstSnapshot=null,rounds=0;
  do{
    const a=store.page({limit:37,cursor});
    assert.equal(a.ok,true);
    assert.equal(a.totalStocks,250);
    assert.equal(a.totalSignals,500);
    assert.equal(a.totalScanned,5300);
    assert.equal(a.scope,'quant-picks-six-rules');
    assert.equal(a.completeForScope,true);
    assert.equal(a.liveCertified,false);
    if(!firstSnapshot)firstSnapshot=a.snapshotId;
    assert.equal(a.snapshotId,firstSnapshot);
    codes.push(...a.items.map(x=>x.code));count+=a.items.reduce((n,x)=>n+x.hit.length,0);
    cursor=a.nextCursor||'';rounds++;
    assert.ok(rounds<10);
    if(!a.hasMore)break;
  }while(true);
  assert.equal(codes.length,250);
  assert.equal(new Set(codes).size,250);
  assert.equal(count,500);
  assert.equal(cursor,'');
});
test('pagination is never silently mixed across two snapshots',()=>{
  const s=createV6MatchesSnapshotStore();
  s.publish({items:mk(170),asOf:1794299400000,totalScanned:5800,board:'all'});
  const p=s.page({limit:50});
  assert.equal(p.hasMore,true);
  s.publish({items:mk(160),asOf:1794299460000,totalScanned:5700,board:'all'});
  const stale=s.page({limit:50,cursor:p.nextCursor});
  assert.equal(stale.ok,false);
  assert.equal(stale.status,'snapshot-changed');
});
test('reject invalid data, malicious cursors and unsupported board without replacing current snapshot',()=>{
  const s=createV6MatchesSnapshotStore();
  const base=s.publish({items:mk(2),asOf:1794299400000,totalScanned:10,board:'all'});
  assert.equal(base.ok,true);
  const bad=[{items:mk(1),asOf:1794299400001,totalScanned:100,board:'main'},
    {items:mk(1).concat(mk(1)),asOf:1794299400001,totalScanned:100,board:'all'},
    {items:mk(8001),asOf:1794299400001,totalScanned:100,board:'all'},
    {items:mk(1),asOf:0,totalScanned:100,board:'all'}];
  bad.forEach(args=>assert.equal(s.publish(args).ok,false));
  const p=s.page();assert.equal(p.snapshotId,base.snapshotId);
  for(const cursor of ['../etc/passwd','abc','!!!',Buffer.from(base.snapshotId+':9999999').toString('base64url')])
    assert.equal(s.page({limit:1,cursor}).ok,false);
  for(const limit of [0,-1,101,1.5,NaN,'5'])assert.equal(s.page({limit}).ok,false);
});
test('freezes projected data and refuses forged sensitive fields',()=>{
  const s=createV6MatchesSnapshotStore(),rows=mk(1);
  rows[0].accountId='PRIVATE_ACCOUNT';rows[0].token='SECRET';rows[0].hit[0].text='证据甲';
  s.publish({items:rows,asOf:1794299400000,totalScanned:1,board:'all'});
  rows[0].hit[0].text='事后篡改';
  const item=s.page().items[0];
  assert.equal(item.hit[0].text,'证据甲');
  assert.equal(item.token,undefined);
  assert.equal(item.accountId,undefined);
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.hit));
});

test('source timestamps remain unknown and scope is never promoted to all strategies or full market',()=>{
  const s=createV6MatchesSnapshotStore(),rows=mk(2);
  rows[0].quoteAt=1794299300000;rows[0].quoteSource='fixture-vendor';
  rows[1].receivedAt=1794299400000;
  assert.equal(s.publish({items:rows,asOf:1794299400000,totalScanned:1,board:'all'}).ok,false);
  assert.equal(s.publish({items:rows,asOf:1794299400000,totalScanned:10,board:'all',evidence:{hotSectorsReady:false}}).ok,true);
  const page=s.page();
  assert.equal(page.items[0].quoteAt,1794299300000);assert.equal(page.items[0].quoteSource,'fixture-vendor');
  assert.equal(page.items[1].quoteAt,null);assert.equal(page.items[1].quoteSource,null);
  assert.equal(page.coverage.candidateUniverse,'server-available-stocks');
  assert.equal(page.coverage.rule5,'not-evaluated');assert.equal(page.coverage.fullMarketCertified,false);
  assert.equal(page.coverage.allStrategyEngines,false);assert.ok(Object.isFrozen(page.coverage));
});

test('optional public completed-scan archive restores every paginated match after cold restart',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-all-matches-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'snapshot.json'),first=createV6MatchesSnapshotStore({file}),input=mk(140);
  input[0].token='NEVER_PERSIST';input[0].accountId='NEVER_PERSIST';input[0].quoteAt=1794299300000;
  first.publish({items:input,asOf:1794299400000,totalScanned:5000,board:'all',evidence:{hotSectorsReady:true}});
  const oldCursor=first.page({limit:100}).nextCursor;
  const second=createV6MatchesSnapshotStore({file}),page=second.page({limit:100});
  assert.equal(page.ok,true);assert.equal(page.asOf,1794299400000);assert.equal(page.totalStocks,140);
  assert.equal(page.items[0].quoteAt,1794299300000);assert.equal(page.coverage.rule5,'available');
  assert.equal(second.page({limit:100,cursor:page.nextCursor}).items.length,40);
  assert.equal(second.page({limit:100,cursor:oldCursor}).status,'snapshot-changed');
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/NEVER_PERSIST/);
});

test('corrupt or future persisted all-matches data fails closed without exposing parser contents',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-all-matches-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'snapshot.json');
 for(const text of ['private BROKEN',JSON.stringify({schemaVersion:1,asOf:Date.now()+86400000,rows:mk(1),totalScanned:1})]){
  fs.writeFileSync(file,text);const errors=[],store=createV6MatchesSnapshotStore({file,onError:code=>errors.push(code)});
  assert.equal(store.page().status,'not-ready');assert.deepEqual(errors,['v6-matches-display-snapshot-read']);
 }
});
