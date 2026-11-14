'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const A = require('../analysis');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const now = Date.parse('2026-11-13T10:00:00+08:00');
const stocks = n => Array.from({length:n}, (_, i) => ({code:String(600000+i), price:10,
  quoteAt:now-3600000, receivedAt:now-3599000, quoteSource:'fixture', canTrade:false}));
function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-boot-snapshot-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const S = {stocks:[], stocksAt:0, ztPool:[], sectors:[], sectorsInd:[]};
  const errors = [], ingested = [];
  const c = {S, A, fs, path, Date:{now:()=>now},
    STOCKS_SNAP_FILE:path.join(dir,'stocks_snapshot.json'),
    ZTPOOL_SNAP_FILE:path.join(dir,'ztPool_snapshot.json'), SECTORS_FILE:path.join(dir,'sectors.json'),
    atomicWrite:(file, text)=>{fs.writeFileSync(file+'.tmp',text); fs.renameSync(file+'.tmp',file);},
    ingestPx:rows=>ingested.push(rows), _diskFail:()=>assert.fail('unexpected write failure'),
    loadStrategyCards:()=>false, loadAuctionSnapshot:()=>false,
    console:{log:()=>{},error:(...args)=>errors.push(args.join(' '))},
    quoteDayOf:at=>new Date(at+8*3600000).toISOString().slice(0,10).replaceAll('-',''),
    todayStr:()=> '20261113'};
  for (const [startMarker,endMarker] of [
    ['function quoteBasis(', '// ⛔ gb 轮'],
    ['function setAllStocks(', '// 涨跌幅符号'],
    ['function loadSnapshotsOnBoot()', 'async function init()']
  ]) {
    const start=source.indexOf(startMarker), end=source.indexOf(endMarker,start);
    assert.ok(start>=0 && end>start); vm.runInNewContext(source.slice(start,end),c);
  }
  return {c,S,errors,ingested,write:(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data))};
}
test('the smallest accepted live snapshot survives a cold restart without restamping rows', t => {
  const h=harness(t), rows=stocks(100);
  assert.equal(h.c.setAllStocks(rows),true);
  const persisted=fs.readFileSync(h.c.STOCKS_SNAP_FILE,'utf8');
  h.S.stocks=[];h.S.stocksAt=0;h.ingested.length=0;
  h.c.loadSnapshotsOnBoot();
  assert.equal(h.S.stocks.length,100);
  assert.equal(h.S.stocksAt,now);
  assert.deepEqual(JSON.parse(JSON.stringify(h.S.stocks)),rows);
  assert.equal(h.ingested.length,0,'disk recovery must not ingest historical prices as live');
  assert.equal(fs.readFileSync(h.c.STOCKS_SNAP_FILE,'utf8'),persisted);
});
test('an entirely delisted saved pool remains empty after the tally filter', t => {
  const h=harness(t);
  h.write('ztPool_snapshot.json',{day:'20261112',pool:[{code:'002731',name:'萃华退',pct:10}]});
  h.c.loadSnapshotsOnBoot();
  assert.equal(h.S.ztPool.length,0);
  assert.equal(h.S.ztExcluded.count,1);
  assert.equal(h.S.ztDayProbed,false);
});
test('mixed saved pool retains ST stocks and excludes only delisting names', t => {
  const h=harness(t);
  h.write('ztPool_snapshot.json',{day:'20261112',pool:[
    {code:'600001',name:'正常股'},{code:'600002',name:'*ST测试'},{code:'002731',name:'萃华退'}]});
  h.c.loadSnapshotsOnBoot();
  assert.deepEqual(Array.from(h.S.ztPool,x=>x.code),['600001','600002']);
  assert.equal(h.S.ztDay,'20261112');assert.equal(h.S.ztExcluded.count,1);
});
test('future and non-finite snapshot clocks never qualify as fresh', t => {
  const h=harness(t);
  for(const at of [now+1,now+3600000,Infinity,'Infinity',NaN,0]) {
    h.S.stocksAt=at;
    assert.equal(h.c.quoteBasis(15000).fresh,false,String(at));
  }
  for(const [at,fresh] of [[now,true],[now-15000,true],[now-15001,false]]) {
    h.S.stocksAt=at;assert.equal(h.c.quoteBasis(15000).fresh,fresh);
  }
});
test('unknown saved time preserves historical rows without inventing a clock', t => {
  const h=harness(t);
  for(const at of [null,'invalid','Infinity',-1]) {
    h.S.stocks=[];h.S.stocksAt=0;
    h.write('stocks_snapshot.json',{at,rows:stocks(101)});h.c.loadSnapshotsOnBoot();
    assert.equal(h.S.stocks.length,101);assert.equal(h.S.stocksAt,0);
    assert.equal(h.c.quoteBasis().fresh,false);
  }
});
test('disk snapshots cannot replace already populated live state', t => {
  const h=harness(t), live=stocks(102);
  h.S.stocks=live;h.S.stocksAt=now;
  h.S.ztPool=[{code:'600000',name:'实时'}];h.S.sectors=[{name:'实时板块'}];
  h.write('stocks_snapshot.json',{at:now-86400000,rows:stocks(100)});
  h.write('ztPool_snapshot.json',{day:'20261112',pool:[{code:'600001',name:'旧快照'}]});
  h.write('sectors.json',[{name:'旧板块'}]);h.c.loadSnapshotsOnBoot();
  assert.equal(h.S.stocks,live);assert.equal(h.S.stocksAt,now);
  assert.equal(h.S.ztPool[0].code,'600000');assert.equal(h.S.sectors[0].name,'实时板块');
});
test('corrupt stock JSON reports a bounded diagnostic and does not prevent other recovery', t => {
  const h=harness(t);
  fs.writeFileSync(h.c.STOCKS_SNAP_FILE,'{"privateMarker":"do-not-log", BROKEN');
  h.write('ztPool_snapshot.json',{day:'20261112',pool:[{code:'600001',name:'正常'}]});
  h.c.loadSnapshotsOnBoot();
  assert.equal(h.S.stocks.length,0);assert.equal(h.S.ztPool.length,1);
  assert.equal(h.errors.length,1);assert.match(h.errors[0],/快照/);
  assert.doesNotMatch(h.errors[0],/privateMarker|do-not-log/);
});
test('missing first-boot files are normal and partial universes remain rejected', t => {
  const h=harness(t);h.c.loadSnapshotsOnBoot();assert.equal(h.errors.length,0);
  assert.equal(h.c.setAllStocks(stocks(99)),false);
  h.write('stocks_snapshot.json',{at:now,rows:stocks(99)});h.c.loadSnapshotsOnBoot();
  assert.equal(h.S.stocks.length,0);
});
