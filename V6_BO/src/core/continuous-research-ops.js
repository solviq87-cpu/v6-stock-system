'use strict';
/** Restartable research-only operations. No brokerage connection, order routing,
 * credentials on disk, or automatic promotion of a research signal to live trading. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {makeBundle,verifyBundle}=require('./integrated-run-bundle');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const safe=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function safeRegular(file){
 const p=path.resolve(file);if(!path.isAbsolute(file))throw Error('研究运行输入必须使用绝对路径');
 let walk=path.parse(p).root;for(const item of p.slice(walk.length).split(path.sep).filter(Boolean)){walk=path.join(walk,item);if(fs.lstatSync(walk).isSymbolicLink())throw Error('研究运行输入路径不得包含符号链接');}
 if(!fs.statSync(p).isFile())throw Error('研究运行输入必须是普通文件');
 return p;
}
function safeOutput(directory){
 if(!path.isAbsolute(directory))throw Error('研究输出目录必须是绝对路径');
 const p=path.resolve(directory);let walk=path.parse(p).root;
 for(const item of p.slice(walk.length).split(path.sep).filter(Boolean)){
  walk=path.join(walk,item);if(fs.existsSync(walk)&&fs.lstatSync(walk).isSymbolicLink())throw Error('研究输出路径不得包含符号链接');
 }
 return p;
}
function writeAtomic(file,payload){
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.ops-'+crypto.randomBytes(10).toString('hex'));
 let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(payload,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);
  const dd=fs.openSync(dir,'r');try{fs.fsyncSync(dd);}finally{fs.closeSync(dd);}
 }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function summarizeRun(report,{runId,reused,replayed}){
 return {runId,source:report.marketQuality.source,asOf:report.asOf,
  marketQuality:report.marketQuality.summary,marketIssues:report.marketQuality.issues,
  strategyDiagnostics:report.strategyDiagnostics.systems,
  independentPortfolios:Object.fromEntries(Object.entries(report.independentPortfolios.systems).map(([k,v])=>[k,v.metrics])),
  gate:report.gate,replayed,reused};
}
function makeOperations({historyPath,outputRoot,snapshotsPath,evidencePath,pythonScript,pollMs=60000,maxInputBytes=30*1024*1024}={}){
 if(!historyPath||!outputRoot)throw Error('需要历史数据和统一研究输出目录');
 if(evidencePath&&pythonScript)throw Error('Python原生执行与证据文件不可同时使用');
 if(!Number.isSafeInteger(pollMs)||pollMs<1000||pollMs>86400000)throw Error('研究轮询间隔无效');
 if(!Number.isSafeInteger(maxInputBytes)||maxInputBytes<1024||maxInputBytes>30*1024*1024)throw Error('研究输入大小限制无效');
 const inputs={historyPath:safeRegular(historyPath),outputRoot:safeOutput(outputRoot)};
 for(const key of ['snapshotsPath','evidencePath','pythonScript'])if({snapshotsPath,evidencePath,pythonScript}[key])inputs[key]=safeRegular({snapshotsPath,evidencePath,pythonScript}[key]);
 let running=false,lastFingerprint=null,lastSuccess=null,lastCheck=null,lastError=null,lastSummary=null,attempts=0,successfulRuns=0;
 const statusFile=path.join(inputs.outputRoot,'operations-status.json');
 if(fs.existsSync(statusFile)){
  try{const prior=JSON.parse(fs.readFileSync(safeRegular(statusFile),'utf8'));
   if(prior.schemaVersion===1&&prior.mode==='offline-continuous-research'&&prior.canTrade===false){
    // Prior file is only a hint, never evidence of success until archive replay succeeds.
    if(prior.lastSummary?.runId&&/^[a-f0-9]{24}$/.test(prior.lastSummary.runId)){
     const dir=path.join(inputs.outputRoot,prior.lastSummary.runId);
     verifyBundle(dir,{replay:true});const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
     lastSummary=summarizeRun(report,{runId:prior.lastSummary.runId,replayed:true,reused:true});lastSuccess=prior.lastSuccess;
    }
   }
  }catch{/* Invalid, missing or tampered metadata cannot authorize any run. */}
 }
 function view(){return {schemaVersion:1,mode:'offline-continuous-research',canTrade:false,verifiedLive:false,
  running,lastCheck,lastSuccess,lastError,attempts,successfulRuns,lastSummary};}
 function sourceFingerprint(){const parts=[];
  for(const key of ['historyPath','snapshotsPath','evidencePath','pythonScript']){
   if(!inputs[key])continue;
   const file=safeRegular(inputs[key]),s=fs.statSync(file);
   if(s.size>maxInputBytes)throw Error('研究输入文件超过上限: '+key);
   parts.push(`${key}:${sha(fs.readFileSync(file))}`);
  }
  return sha(parts.join('|'));
 }
 function runOnce(){
  if(running)return {updated:false,reason:'busy'};
  running=true;attempts++;lastCheck=new Date().toISOString();
  try{
   const digest=sourceFingerprint();
   if(digest===lastFingerprint){lastError=null;return {updated:false,reason:'unchanged',lastSummary};}
   const r=makeBundle({...inputs,reuseExisting:true});
   const verified=verifyBundle(r.directory,{replay:true});
   const report=JSON.parse(fs.readFileSync(path.join(r.directory,'report.json'),'utf8'));
   const summary=summarizeRun(report,{runId:r.runId,replayed:verified.replayed,reused:Boolean(r.reused)});
   const snapshot={schemaVersion:1,mode:'offline-continuous-research',canTrade:false,verifiedLive:false,
    lastCheck,lastSuccess:new Date().toISOString(),lastError:null,lastSummary:summary};
   writeAtomic(statusFile,snapshot);lastFingerprint=digest;lastSummary=summary;lastSuccess=snapshot.lastSuccess;lastError=null;successfulRuns++;
   return {updated:!r.reused,reused:Boolean(r.reused),summary};
  }catch(err){lastError=err.message;return {updated:false,error:lastError};}
  finally{running=false;}
 }
 return {runOnce,status:view,inputs:{outputRoot:inputs.outputRoot},pollMs};
}
const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>V6 四策略研究监控</title><style>*{box-sizing:border-box}body{margin:0;background:#071529;color:#e6f1ff;font:15px system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:22px 16px 90px}h1{font-size:25px;margin-bottom:5px}h2{font-size:17px;margin:0 0 12px}.sub{color:#a9c0dc}.warn{color:#ffc777}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:20px}.card{border:1px solid #355074;background:#122642;border-radius:15px;padding:17px;overflow:hidden}.wide{grid-column:span 4}.metric{font-size:25px;font-weight:700;overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}th,td{padding:11px;text-align:left;border-bottom:1px solid #355074}input,button{font:inherit;border-radius:9px;padding:11px;min-height:44px}input{background:#091b32;border:1px solid #547596;color:white}button{background:#266ab3;border:0;color:white;cursor:pointer}header{display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap}.status{min-height:28px}@media(max-width:720px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{padding:13px}.wide{grid-column:span 2}h1{font-size:21px}.metric{font-size:21px}header form{width:100%;display:flex;gap:8px}header input{min-width:0;flex:1}}</style></head><body><main><header><div><h1>V6 · 四策略统一研究监控</h1><div class="sub">只读 · 独立模拟账户 · 绝不连接券商</div></div><form id="auth"><input type="password" id="token" autocomplete="off" aria-label="本机访问令牌" placeholder="输入访问令牌" required><button>连接</button></form></header><p id="status" class="status" role="status">输入令牌后查看最近一次可复现的研究报告</p><section class="grid"><article class="card"><h2>数据截至日期</h2><div class="metric" id="asof">—</div></article><article class="card"><h2>行情来源</h2><div class="metric" id="source">—</div></article><article class="card"><h2>股票数量</h2><div class="metric" id="stocks">—</div></article><article class="card"><h2>审计状态</h2><div class="metric" id="audit">—</div></article><article class="card wide"><h2>四策略独立模拟表现（研究估算）</h2><div class="scroll"><table><thead><tr><th>策略</th><th>原生有效证据</th><th>纸面已平仓</th><th>纸面收益%</th><th>最大回撤%</th><th>样本外单笔%</th><th>警示</th></tr></thead><tbody id="rows"></tbody></table></div></article><article class="card wide"><h2>行情数据质量与验收阻断</h2><p id="quality" class="warn">—</p><p id="blockers" class="warn">—</p></article></section><p class="sub">未知策略结果不替换为买入，纸面结果不证明实盘成交；不具备实盘授权。</p></main><script>let secret='';const el=id=>document.getElementById(id);function set(id,v){el(id).textContent=v===null||v===undefined?'—':String(v)}async function update(){if(!secret)return;try{const r=await fetch('/api/ops/latest',{cache:'no-store',headers:{Authorization:'Bearer '+secret}});if(!r.ok)throw Error('研究服务错误 '+r.status);const j=await r.json(),s=j.data||{};if(!s.runId)throw Error('还没有可复现的完整研究档案');set('asof',s.asOf);set('source',s.source);set('stocks',s.marketQuality?.stocks);set('audit',s.replayed?'已重放':'未验证');const rows=el('rows');rows.replaceChildren();for(const k of ['fourteen','bazi','gpt','python']){const h=s.strategyDiagnostics?.[k]||{},p=s.independentPortfolios?.[k]||{};const tr=document.createElement('tr');for(const v of [k,h.evaluated,p.closedTrades,p.returnPct,p.maxDrawdownPct,h.holdoutMeanReturnPct,(h.warnings||[]).join('；')]){const td=document.createElement('td');td.textContent=v===null||v===undefined?'—':String(v);tr.append(td)}rows.append(tr)}set('quality',(s.marketIssues||[]).map(x=>x.detail).join('；')||'待人工供应商验收');set('blockers',(s.gate?.blockers||[]).join('；'));set('status','已加载可重放研究运行 '+s.runId+'；仅研究，不执行交易')}catch(e){set('status',e.message)}}el('auth').addEventListener('submit',e=>{e.preventDefault();secret=el('token').value;el('token').value='';update()});setInterval(()=>{if(secret)update()},30000)</script></body></html>`;
function createResearchOpsServer({operations,token,port=0,host='127.0.0.1'}={}){
 if(!operations||typeof operations.runOnce!=='function'||typeof operations.status!=='function')throw Error('缺少连续研究控制器');
 if(typeof token!=='string'||token.length<24)throw Error('访问令牌至少需要24字符');
 if(!['127.0.0.1','::1','localhost'].includes(host))throw Error('研究服务只允许本机监听');
 let timer=null;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'");
  const send=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
  if(req.method!=='GET')return send(405,{ok:false,error:'只读服务'});
  if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(page);}
  if(!safe(req.headers.authorization,'Bearer '+token))return send(401,{ok:false,error:'未授权'});
  if(req.url==='/api/ops/health')return send(200,{ok:true,mode:'offline-research-only',canTrade:false,lastSuccess:operations.status().lastSuccess,lastError:operations.status().lastError});
  if(req.url==='/api/ops/status')return send(200,{ok:true,data:operations.status()});
  if(req.url==='/api/ops/latest')return send(operations.status().lastSummary?200:503,{ok:Boolean(operations.status().lastSummary),data:operations.status().lastSummary,error:operations.status().lastSummary?null:'尚无完整档案'});
  return send(404,{ok:false,error:'接口不存在'});
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);operations.runOnce();timer=setInterval(()=>operations.runOnce(),operations.pollMs);timer.unref();resolve(server.address());});}),
  close:()=>new Promise((resolve,reject)=>{if(timer)clearInterval(timer);server.close(err=>err?reject(err):resolve());})};
}
module.exports={makeOperations,createResearchOpsServer};
