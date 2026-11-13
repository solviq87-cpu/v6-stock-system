'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const catalog=require('../config/six-photo-sources.json');const {buildBank:build,selectBackup:select,readSixPhotoBank:read,photoQuoteFallback:fallback}=require('../src/core/six-photo-backups');
const now=Date.parse('2026-11-06T08:00:00Z');
function fixture(){return {schemaVersion:1,mode:'six-photo-source-backups',scope:catalog.scope,code:'600519',start:'2026-11-02',end:'2026-11-06',generatedAt:now,canTrade:false,verifiedLive:false,paidServicesUsed:false,sources:catalog.entries.map(e=>({...e,status:e.requires==='client'?'client-required':e.requires==='credentials'?'credentials-required':'unavailable',observedAt:now,instrument:{kind:e.kind==='fund-nav'?'fund':'stock',code:e.kind==='fund-nav'?'161725':'600519'}}))};}
function returned(r,id,records){const s=r.sources.find(x=>x.id===id);s.status='returned';s.data={records,columns:Object.keys(records[0]),truncated:false};return s;}
const bar={日期:'2026-11-05',股票代码:'600519',开盘:10,收盘:11,最高:12,最低:9,成交量:100,成交额:110000};
test('exact six photos define thirty row identities and six photo08 checks without unrelated feeds',()=>{
 assert.equal(catalog.entries.length,30);assert.equal(new Set(catalog.entries.map(x=>x.id)).size,30);assert.equal(catalog.photo08Checks.length,6);
 for(const photo of ['03','04','05','06','07'])assert.equal(catalog.entries.filter(e=>e.photo===photo).length,6);
 assert.ok(!catalog.entries.some(e=>['mootdx','ashare','openbb'].includes(e.provider)));
});
test('daily backups preserve adjustment and upstream; incompatible qfq and shared upstream exclusion never silently substitute',()=>{
 const r=fixture();returned(r,'akshare.daily',[bar]);returned(r,'efinance.daily',[bar]);const bank=build(r,now);
 assert.equal(select(bank,{kind:'daily',code:'600519'}).records[0].close,11);
 assert.equal(select(bank,{kind:'daily',code:'600519',adjustment:'qfq'}),null);
 assert.equal(select(bank,{kind:'daily',code:'600519',excludeUpstreams:['eastmoney']}),null);
});
test('daily, minute, fund NAV and announcements keep separate instruments and never fill realtime prices',()=>{
 const r=fixture();returned(r,'akshare.daily',[bar]);returned(r,'efinance.fund.nav',[{日期:'2026-11-05',单位净值:2,累计净值:3}]);
 const bank=build(r,now);assert.equal(select(bank,{kind:'quote',code:'600519'}),null);assert.equal(select(bank,{kind:'fund-nav',code:'600519'}),null);assert.equal(select(bank,{kind:'fund-nav',code:'161725'}).records[0].nav,2);
});
test('quote snapshots with unknown or stale original times stay visible but cannot become active price backups',()=>{
 for(const extra of [{},{date:'2026-11-06',time:'15:00:00'}]){const r=fixture();returned(r,'easyquotation.realtime',[{now:10,...extra}]);const bank=build(r,now);assert.equal(bank.availableCount,1);assert.equal(select(bank,{kind:'quote',code:'600519'}),null);}
});
test('future, wrong-symbol, negative or malformed rows fail only their own source without inventing zero',()=>{
 for(const change of [x=>x.股票代码='000001',x=>x.收盘=0,x=>x.最高=1,x=>x.成交量=null]){const r=fixture(),row={...bar};change(row);returned(r,'akshare.daily',[row]);returned(r,'efinance.daily',[bar]);const bank=build(r,now);assert.equal(bank.sources.find(x=>x.id==='akshare.daily').status,'data-invalid');assert.equal(select(bank,{kind:'daily',code:'600519'}).id,'efinance.daily');}
});
test('minute bars require original Shanghai timestamps and never accept future bars',()=>{
 const r=fixture();returned(r,'akshare.minute.em',[{...bar,日期:undefined,时间:'2026-11-06 14:55:00'}]);const bank=build(r,now);assert.equal(select(bank,{kind:'minute',code:'600519',frequency:'1min'}),null);assert.equal(select(bank,{kind:'minute',code:'600519'}).frequency,'5min');assert.equal(select(bank,{kind:'minute',code:'600519'}).records[0].timestamp,Date.parse('2026-11-06T06:55:00Z'));
 const bad=fixture();returned(bad,'akshare.minute.em',[{...bar,日期:undefined,时间:'2026-11-06 16:05:00'}]);assert.equal(build(bad,now).availableCount,0);
});
test('cninfo uppercase PDF files work, text strips markup and future or mismatched disclosures reject',()=>{
 const r=fixture();const record={secCode:'600519',announcementId:'123',announcementTitle:'<b>公告</b>',announcementTime:now-1,adjunctUrl:'finalpage/2026-11-06/123.PDF'};
 returned(r,'cninfo.announcements',[record]);const bank=build(r,now);assert.equal(select(bank,{kind:'announcements',code:'600519'}).records[0].title,'公告');
 returned(r,'cninfo.announcements',[{...record,announcementTime:now+1}]);assert.equal(build(r,now).availableCount,0);
});
test('catalog identity, duplicate IDs, future clock and paid/trading claims reject the whole bank',()=>{
 for(const mutate of [r=>r.sources[0].upstream='other',r=>r.sources[0]=r.sources[1],r=>r.generatedAt=now+1,r=>r.canTrade=true,r=>r.paidServicesUsed=true]){const r=fixture();mutate(r);assert.throws(()=>build(r,now));}
});
test('bank expiry cannot reactivate frozen quotes',()=>{
 const r=fixture();returned(r,'easyquotation.realtime',[{now:10,date:'2026-11-06',time:'16:00:00'}]);assert.equal(select(build(r,now),{kind:'quote',code:'600519'}).records.length,1);
 assert.equal(select(build(r,now+86400001),{kind:'quote',code:'600519'}),null);
});
test('fixed-file fallback validates symbols/time and does not expose raw fields or synthesize missing cashflow',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'photo-bank-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'bank.json'),r=fixture();returned(r,'easyquotation.realtime',[{now:10,close:9,date:'2026-11-06',time:'16:00:00',secret:'PRIVATE_PHOTO_SENTINEL'}]);fs.writeFileSync(file,JSON.stringify(r));
 const rows=fallback(['600519','000001'],file,now);assert.equal(rows.length,1);assert.equal(rows[0].mainInflow,null);assert.equal(rows[0].canTrade,false);assert.ok(!JSON.stringify(read(file,now)).includes('PRIVATE_PHOTO_SENTINEL'));
 const link=path.join(dir,'link');fs.symlinkSync(file,link);assert.equal(read(link,now).status,'invalid');fs.writeFileSync(file,'{}');assert.equal(read(file,now).status,'invalid');
});
test('existing batch quote chain uses photo backup only after original sources fail',async()=>{
 const source=fs.readFileSync(require.resolve('../em.js'),'utf8'),start=source.indexOf('async function fetchBatchSnapshot(codes)'),end=source.indexOf('async function fetchBatchSnapshotEM',start);let n=0;
 const now=Date.parse('2026-11-13T10:00:00+08:00');class Clock extends Date{static now(){return now;}}
 const row={code:'600519',price:10,quoteAt:now-1000,receivedAt:now,quoteSource:'research-backup',quoteFreshness:'recent-unverified',canTrade:false};
 const c={Date:Clock,_srcWarn(){},classifyNetErr:require('../em').classifyNetErr,fetchBatchSnapshotEM:async()=>{throw Error('offline');},fetchBatchSnapshotTx:async()=>{throw Error('offline');},require:()=>({photoQuoteFallback:()=>{n++;return [{...row}];}})};vm.createContext(c);vm.runInContext(source.slice(start,end),c);const first=await c.fetchBatchSnapshot(['600519']);assert.equal(first.length,1);assert.equal(first[0].canTrade,false);assert.equal(n,1);
 c.fetchBatchSnapshotEM=async()=>[];await c.fetchBatchSnapshot(['600519']);assert.equal(n,2);
 c.fetchBatchSnapshotEM=async()=>[{...row,quoteSource:'eastmoney',canTrade:true}];await c.fetchBatchSnapshot(['600519']);assert.equal(n,2);
});
test('display-only photo backup rows do not enter lastPx used by simulated account execution',()=>{
 const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf('function ingestPx(rows)'),end=source.indexOf('function paperPrices()',start),c={S:{lastPx:new Map()},Date};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 c.ingestPx([{code:'600519',price:10,canTrade:false},{code:'000001',price:9,quoteSource:'tencent',quoteAt:Date.now()-1000}]);assert.equal(c.S.lastPx.has('600519'),false);assert.equal(c.S.lastPx.get('000001').p,9);
});
test('Python runner preflights every credential/client row without importing SDKs or spawning paid requests',()=>{
 const script=path.resolve(__dirname,'../scripts/six-photo-sources.py');const result=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-c',`import runpy,subprocess\nn=runpy.run_path(${JSON.stringify(script)})\nassert len(n['plan']())==30 and len(set(n['plan']()))==30 and n['plan']()[-1]=='easyquotation.realtime'\ndef fail(*a,**k):raise AssertionError('must not spawn')\nsubprocess.run=fail\nfor ident,e in n['ENTRIES'].items():\n if e['requires']!='public':\n  r=n['collect'](ident,'600519','2026-11-02','2026-11-06','161725')\n  assert r['requestAttempted'] is False\n  assert r['status'] in ('credentials-required','client-required')\n`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('Python input and no-overwrite/symlink protection reject before any network operation',()=>{
 const script=path.resolve(__dirname,'../scripts/six-photo-sources.py');const result=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-c',`import runpy,tempfile,pathlib\nn=runpy.run_path(${JSON.stringify(script)})\ntry:n['validate']('../evil','2026-11-02','2026-11-06','161725');raise AssertionError()\nexcept ValueError:pass\nwith tempfile.TemporaryDirectory() as d:\n p=pathlib.Path(d)/'report.json';n['publish'](p,{'fixture':True})\n try:n['publish'](p,{});raise AssertionError()\n except FileExistsError:pass\n link=pathlib.Path(d)/'link';link.symlink_to(p)\n try:n['safe_path'](link);raise AssertionError()\n except ValueError:pass\n`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('explicit quote symbol mismatch and Sina bars outside the requested interval cannot enter backups',()=>{
 const r=fixture();returned(r,'easyquotation.realtime',[{code:'000001',now:10,date:'2026-11-06',time:'16:00:00'}]);assert.equal(build(r,now).availableCount,0);
 const m=fixture();returned(m,'akshare.minute.sina',[{day:'2026-10-30 14:55:00',open:'10',close:'11',high:'12',low:'9',volume:'100'}]);assert.equal(build(m,now).availableCount,0);
});
test('quote refresh atomically updates a separate active file, removes old successful quote on failure and keeps history/base unchanged',()=>{
 const script=path.resolve(__dirname,'../scripts/six-photo-sources.py'),base=JSON.stringify(fixture());
 const code=`import runpy,json,tempfile,pathlib,copy\nn=runpy.run_path(${JSON.stringify(script)})\nbase=json.loads(${JSON.stringify(base)})\nq=next(x for x in base['sources'] if x['id']=='easyquotation.realtime');q['status']='returned';q['data']={'records':[{'now':10}]}\noriginal=copy.deepcopy(base)\ndef failed(*args):\n x=copy.deepcopy(q);x.pop('data');x['status']='unavailable';return x\nupdated=n['refresh_quote'](base,'600519','2026-11-02','2026-11-06','161725',failed)\nassert base==original\nassert next(x for x in updated['sources'] if x['id']=='easyquotation.realtime')['status']=='unavailable'\nassert 'data' not in next(x for x in updated['sources'] if x['id']=='easyquotation.realtime')\nassert updated['sources'][0]==base['sources'][0]\nwith tempfile.TemporaryDirectory() as d:\n p=pathlib.Path(d)/'active.json';n['activate'](p,base);n['activate'](p,updated)\n assert json.loads(p.read_text())==updated\n link=pathlib.Path(d)/'link';link.symlink_to(p)\n try:n['activate'](link,base);raise AssertionError()\n except ValueError:pass\n`;
 const r=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-c',code],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
