'use strict';
// Disposable original server and authenticated native UI. Financial observations
// are synthetic; no supplier, notification gateway or real account is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS;assert.ok(out);fs.mkdirSync(out,{recursive:true});
const now=Date.parse('2026-11-27T10:00:00+08:00'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-expiry-clock-')),clock=path.join(dir,'clock');fs.writeFileSync(clock,String(now));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const baselineRef='6ba43926503fe8e61d4d56bad6e07da53e9e9496';
const row={code:'600001',name:'时效隔离样本',price:10,pct:1,score:90,quoteAt:now,vendorQuoteAt:now,receivedAt:now,quoteSource:'expiry-fixture',quoteStatus:'recent-unverified',source:'expiry-fixture',signals:['隔离时效观察']};
row.conclusion={authority:'fayo-decision-center',schemaVersion:1,code:row.code,day:'2026-11-27',asOf:now,label:'可关注',reason:'隔离时效样本，非真实交易建议',evidence:[]};
(async()=>{
 let source=fs.readFileSync('server.js','utf8'),anchor='let _quantPicksCache = { ts: 0, data: null, busy: false };';assert.equal(source.split(anchor).length,2);
 source=source.replace(anchor,`S.candidatePool=[${JSON.stringify(row)}];S.stocks=[${JSON.stringify(row)}];S.stocksAt=${now};\n`+anchor);
 const f=await createFixture({count:0,clockFile:clock,serverSource:source});
 try{
  if(process.env.FAYO_EXPIRY_BASELINE==='1')for(const file of ['ui.js','market.js'])fs.writeFileSync(path.join(f.tmp,'public/nova',file),execFileSync('git',['show',baselineRef+':V6_BO/public/nova/'+file]));
  const state=await f.request('/api/state');assert.equal(state.status,200);assert.ok(state.body.pool.some(x=>x.code===row.code));
  const snapshot=()=>Object.fromEntries(['data/paper-accounts','data/research-paper'].flatMap(name=>{const root=path.join(f.tmp,name);if(!fs.existsSync(root))return [];return fs.readdirSync(root,{recursive:true}).map(file=>path.join(root,file)).filter(file=>fs.statSync(file).isFile()).map(file=>[path.relative(f.tmp,file),sha(fs.readFileSync(file))]);}));
  const before=snapshot(),r=spawnSync(process.env.FAYO_BROWSER_PYTHON||'python',[path.join(__dirname,'browser.py')],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,now,output:out,baseline:process.env.FAYO_EXPIRY_BASELINE==='1'}),encoding:'utf8',timeout:180000});
  assert.equal(r.status,0,r.stderr.slice(-3000));assert.deepEqual(snapshot(),before,'UI expiry cannot write account files');
  const hashes=Object.fromEntries(['public/nova/ui.js','public/nova/market.js','public/nova/app.js','src/core/paper-plan-notice-review.js'].filter(file=>fs.existsSync(file)).map(file=>[file,sha(fs.readFileSync(file))]));
  const servedUiHashes=Object.fromEntries(['ui.js','market.js'].map(file=>[file,sha(fs.readFileSync(path.join(f.tmp,'public/nova',file)))]));
  fs.writeFileSync(path.join(out,'native.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:hashes,servedUiHashes,stateHttp:state.status,syntheticInputs:true,accountFilesBefore:before,accountFilesUnchanged:true,temporaryServerSha256:sha(fs.readFileSync(path.join(f.tmp,'server.js'))),baseline:process.env.FAYO_EXPIRY_BASELINE==='1',baselineRef},null,2)+'\n');
  console.log(JSON.stringify({stateHttp:200,accountFilesUnchanged:true,browser:JSON.parse(fs.readFileSync(path.join(out,'browser.json'),'utf8')).map(x=>({width:x.width,expired:x.expired,baseline:x.baseline}))}));
 }finally{await f.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
