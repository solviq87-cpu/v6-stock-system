#!/usr/bin/env node
'use strict';
// Real authority -> derived risk journal -> native browser, entirely isolated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {fixture,BASE}=require('../tests/helpers/account-equity-fixture');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const publicRoot=path.resolve(__dirname,'../public');
const output=process.env.FAYO_RISK_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-risk-browser-'));
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),day='2026-11-23',calendar={isOpen:()=>true};
fs.mkdirSync(output,{recursive:true});
f.buy('600000',100,10);f.buy('600001',100,10);
f.service.submit({orderId:'risk-ui-pending',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:day});
f.service.configure({expectedRevision:f.service.read().revision,riskPolicy:{version:'risk-ui-original-policy-v1',maxGrossExposurePct:1}});
const pre=createPaperApplicationService({file:path.join(f.root,'pre.json'),clock:()=>f.now,calendar});pre.initialize(500000);
let stale=false,unavailable=false;
const runtime=createRiskWorkbenchRuntime({root:path.join(f.root,'derived'),clock:()=>f.now,isPrimary:()=>true,planEnabled:()=>true,
  readBook:key=>key==='pool'?f.service.read():pre.read(),readQuotes:()=>Object.fromEntries(['600000','600001'].map(code=>[code,
    f.quote(code,10,{timestamp:f.now-(stale?16000:0),quoteAt:f.now-(stale?16000:0),receivedAt:f.now,tradeDate:day})])),
  readResearch:()=>({market:{quotes:{total:2,recent:stale?0:2},receivedAt:f.now},supports:[],contra:[],missing:[],
    manualHoldings:{status:'unconfigured',positions:[],alerts:[]},strategyDecay:{status:'unknown',reason:'独立成熟样本不足，校准状态未知'}}),
  readPlans:async()=>({ok:true,state:{plans:[]}}),readObservations:async()=>({records:[],alerts:[]}),
  readAutomaticPolicy:()=>({maxPos:5,sl:-.03,tp:.08,expireDays:4}),readOriginalExitChecks:()=>({}),
  readMarket:()=>({classificationSnapshot:{day,knownAt:BASE-1000,facts:{600000:{themes:['共同题材','其他题材']},600001:{themes:['共同题材']}}}}),
  calendar,session:()=>({day,continuous:true}),privateReady:()=>false,
  sendPrivate:()=>{throw Error('browser fixture cannot send real notifications');}});

async function main(){
  await runtime.tick();f.setNow(BASE+60000);await runtime.tick();
  const authoritativeFiles=['authority.json','pre.json'].map(file=>[file,fs.readFileSync(path.join(f.root,file))]);
  const requests=[],external=[],errors=[],views=[];let browser;
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    try{
      if(u.pathname==='/'||u.pathname==='/m'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main class="fy-main" id="mount"></main></body></html>');}
      if(u.pathname.startsWith('/api/')){
        requests.push({method:req.method,path:u.pathname,query:u.search});res.setHeader('Content-Type','application/json');
        if(req.headers['x-fixture-role']!=='edit'){res.writeHead(403);return res.end(JSON.stringify({ok:false,error:'private'}));}
        if(u.pathname==='/api/risk-workbench'&&req.method==='GET'){
          if(unavailable){res.writeHead(503);return res.end(JSON.stringify({ok:false,error:'隔离风险读取失败'}));}
          return res.end(JSON.stringify({ok:true,result:await runtime.read({accountId:u.searchParams.get('account')||'pool',code:u.searchParams.get('code'),actor:'isolated-browser'})}));
        }
        if(u.pathname==='/api/risk-workbench/alerts'&&req.method==='POST'){
          let raw='';for await(const chunk of req)raw+=chunk;
          return res.end(JSON.stringify({ok:true,result:await runtime.update(JSON.parse(raw),{actor:'isolated-browser',authorized:()=>true})}));
        }
        if(u.pathname==='/api/holdings'&&req.method==='GET')return res.end(JSON.stringify({ok:true,items:[],summary:{},cfg:{},allTags:[]}));
        res.writeHead(405);return res.end(JSON.stringify({ok:false,error:'fixture cannot transact'}));
      }
      if(!/^\/nova\/[\w./-]+$/.test(u.pathname)||u.pathname.includes('..')){res.writeHead(404);return res.end();}
      res.setHeader('Content-Type',u.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,u.pathname)));
    }catch(error){res.writeHead(422);res.end(JSON.stringify({ok:false,error:error.message}));}
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
    for(const viewport of [{width:1366,height:1000,path:'/'},{width:390,height:844,path:'/m'}]){
      const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}});
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
      try{
        await page.goto(origin+viewport.path);
        await page.evaluate(async now=>{
          const {renderOperations}=await import('/nova/operations.js'),{createRiskSummary}=await import('/nova/risk-workbench-view.mjs');
          const OriginalDate=Date;window.testNow=now;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.testNow]));}static now(){return window.testNow;}};
          window.showRisk=(view='risk',role='edit')=>{
            window.controller?.abort();window.controller=new AbortController();
            const ctx={role,canEdit:role==='edit',signal:window.controller.signal,state:{},workspaceNavigation:true,onState:()=>{},
              navigate:()=>{},selectStock:()=>{},notify:(message)=>{window.lastNotice=message;},api:async(p,options={})=>{
                const reply=await fetch(p,{method:options.method||'GET',body:options.body?JSON.stringify(options.body):undefined,
                  headers:{'X-Fixture-Role':role,'Content-Type':'application/json'},signal:options.signal});return reply.json();}};
            const node=view==='risk'?renderOperations({view:'assets',sub:'risk'},ctx):createRiskSummary(ctx,{code:view==='stock'?'600000':null});
            document.getElementById('mount').replaceChildren(node);
          };
        },f.now);
        stale=false;await page.evaluate(()=>window.showRisk());
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        const text=await page.locator('#mount').innerText();
        assert.match(text,/未成交买单敞口/);assert.match(text,/1,000/);assert.match(text,/核验时点权益/);
        assert.match(text,/已结算盈亏/);assert.match(text,/持仓浮盈亏/);assert.match(text,/连续全账户最大回撤/);
        assert.match(text,/未配置 \/ 未启用/);assert.match(text,/网关受理仍未证明接收端收到/);
        assert.equal(await page.locator('[data-risk-severity="critical"]').count(),1);
        const root=page.locator('[data-risk-root="rule/maxGrossExposurePct"]'),riskId=await root.getAttribute('data-risk-id');
        if(await root.getByRole('button',{name:'标为已查看',exact:true}).count())await root.getByRole('button',{name:'标为已查看',exact:true}).click();
        await root.getByRole('button',{name:'已查看',exact:true}).waitFor();
        if(await root.getByRole('button',{name:'恢复通知',exact:true}).count()){
          await root.getByRole('button',{name:'恢复通知',exact:true}).click();await root.getByRole('button',{name:'静音30分钟',exact:true}).waitFor();
        }
        await root.getByRole('button',{name:'静音30分钟',exact:true}).click();await root.getByRole('button',{name:'恢复通知',exact:true}).waitFor();
        assert.match(await root.innerText(),/通知静音 · 站内限制保留/);
        await root.getByRole('button',{name:'恢复通知',exact:true}).click();await root.getByRole('button',{name:'静音30分钟',exact:true}).waitFor();
        await page.getByRole('button',{name:'关键风险静音30分钟',exact:true}).click();
        await page.getByRole('button',{name:'恢复关键风险通知',exact:true}).waitFor();
        assert.equal(await root.getByRole('button',{name:'已随类别静音',exact:true}).isDisabled(),true,
          'a root-level control cannot pretend it removed a category mute');
        assert.match(await root.innerText(),/当前限制/);
        await page.getByRole('button',{name:'恢复关键风险通知',exact:true}).click();
        await root.getByRole('button',{name:'静音30分钟',exact:true}).waitFor();
        assert.doesNotMatch(await root.innerText(),/通知静音/);
        await root.getByRole('button',{name:'静音30分钟',exact:true}).click();await root.getByRole('button',{name:'恢复通知',exact:true}).waitFor();
        await page.locator('#risk-stress-assumptions summary').click();
        assert.match(await page.locator('#risk-stress-assumptions').innerText(),/价格冲击/);
        assert.match(await page.locator('#risk-stress-assumptions').innerText(),/100/);
        await page.getByRole('button',{name:'刷新风险',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('risk-stress-assumptions')?.open===true);
        await page.context().setOffline(true);
        await page.waitForFunction(()=>!document.querySelector('[data-risk-workbench] [data-risk-id]')&&
          document.querySelector('[data-risk-workbench]')?.textContent.includes('连接已断开'));
        assert.doesNotMatch(await page.locator('#mount').innerText(),/核验时点权益/);
        await page.context().setOffline(false);
        await root.waitFor();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'risk workspace must not overflow viewport');
        await page.screenshot({path:path.join(output,'risk-'+viewport.width+'.png'),fullPage:false});
        await page.evaluate(()=>window.showRisk('home'));
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        assert.equal(await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').getAttribute('data-risk-id'),riskId);
        await page.evaluate(()=>window.showRisk('stock'));
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        assert.equal(await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').getAttribute('data-risk-id'),riskId);
        assert.ok(requests.some(row=>row.query.includes('code=600000')));
        await page.context().setOffline(true);
        await page.waitForFunction(()=>!document.querySelector('[data-risk-summary] [data-risk-id]')&&
          document.querySelector('[data-risk-summary]')?.textContent.includes('连接已断开'));
        await page.context().setOffline(false);
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        assert.equal(await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').getAttribute('data-risk-id'),riskId);
        await page.evaluate(()=>window.showRisk());await page.locator('[aria-label="风险账户"]').selectOption('pre');
        await page.waitForFunction(()=>document.querySelector('[data-risk-workbench]')?.textContent.includes('50.00 万'));
        assert.equal(await page.locator('[data-risk-root="rule/maxGrossExposurePct"][data-risk-severity="critical"]').count(),0);
        await page.locator('[aria-label="风险账户"]').selectOption('pool');
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        unavailable=true;await page.getByRole('button',{name:'刷新风险',exact:true}).click();
        await page.getByText('隔离风险读取失败',{exact:true}).waitFor();
        await page.getByRole('button',{name:'组合',exact:true}).click();
        assert.equal(await page.locator('[data-risk-id]').count(),0,'filtering after read failure cannot resurrect a stale current-risk report');
        assert.doesNotMatch(await page.locator('#mount').innerText(),/核验时点权益/);
        unavailable=false;await page.getByRole('button',{name:'刷新风险',exact:true}).click();
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        stale=true;await page.getByRole('button',{name:'刷新风险',exact:true}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('.fy-metric')].some(node=>node.textContent.includes('核验时点权益')&&node.querySelector('strong')?.textContent==='未知'));
        const beforeViewer=requests.length;await page.evaluate(()=>window.showRisk('risk','view'));
        await page.getByText('这是你的私人工作区',{exact:true}).waitFor();assert.equal(requests.length,beforeViewer);
        assert.doesNotMatch(await page.locator('#mount').innerText(),/100,000|500,000|50\.00 万|600000/);
        const requestIsolation=await page.evaluate(async()=>{
          window.controller?.abort();
          const {createRiskSummary}=await import('/nova/risk-workbench-view.mjs');
          const responses=await Promise.all(['600000','600001'].map(code=>fetch('/api/risk-workbench?account=pool&code='+code,
            {headers:{'X-Fixture-Role':'edit'}}).then(res=>res.json())));
          const pending=[],old=new AbortController(),next=new AbortController();
          const node=createRiskSummary({role:'edit',navigate:()=>{},api:(url,{signal})=>new Promise(resolve=>pending.push({resolve,signal}))},{autoload:false});
          document.getElementById('mount').replaceChildren(node);
          const initial=node.refresh({code:'600000'});pending.shift().resolve(responses[0]);await initial;
          const a=node.refresh({code:'600000',signal:old.signal}),b=node.refresh({code:'600001',signal:next.signal});
          const clearedWhileLoading=!node.querySelector('[data-risk-id]');
          old.abort();const isolated=!pending[1].signal.aborted;
          pending[1].resolve(responses[1]);await b;const latest=node.textContent;
          pending[0].resolve(responses[0]);await a;
          const result=clearedWhileLoading&&isolated&&node.textContent===latest&&latest.length>20;
          node.dispose();return result;
        });
        assert.equal(requestIsolation,true,'an old stock request abort or late response must not cancel or replace the new stock');
        const privacyAndAccounts=await page.evaluate(async()=>{
          const {renderRiskWorkbench,createRiskSummary}=await import('/nova/risk-workbench-view.mjs');
          const responses=await Promise.all(['pool','pre'].map(account=>fetch('/api/risk-workbench?account='+account,
            {headers:{'X-Fixture-Role':'edit'}}).then(res=>res.json())));
          const pending=[],listeners=[],lifetime=new AbortController();let role='edit';
          const ctx={get role(){return role;},get canEdit(){return role==='edit';},navigate:()=>{},
            signal:lifetime.signal,
            onState:fn=>listeners.push(fn),api:(_path,options)=>new Promise(resolve=>pending.push({resolve,options}))};
          const node=renderRiskWorkbench(ctx);document.getElementById('mount').replaceChildren(node);
          await Promise.resolve();
          const chooser=node.querySelector('[aria-label="风险账户"]');chooser.value='pre';chooser.dispatchEvent(new Event('change'));
          pending[1].resolve(responses[1]);await new Promise(resolve=>setTimeout(resolve,0));
          const latest=node.textContent;pending[0].resolve(responses[0]);await new Promise(resolve=>setTimeout(resolve,0));
          const accountIsolation=node.textContent===latest&&latest.includes('50.00 万')&&!latest.includes('1,000.00');
          const beforeRevoke=pending.length;role='view';listeners.forEach(fn=>fn());
          const revokedClearsImmediately=!node.querySelector('[data-risk-id]')&&!node.textContent.includes('50.00 万')&&pending.length===beforeRevoke;
          role='edit';const summary=createRiskSummary(ctx,{autoload:false});document.getElementById('mount').append(summary);
          const job=summary.refresh();const response=pending.at(-1);role='view';listeners.forEach(fn=>fn());response.resolve(responses[0]);await job;
          const result={accountIsolation,revokedClearsImmediately,lateRevokedSummaryHidden:summary.hidden&&!summary.querySelector('[data-risk-id]')};
          lifetime.abort();return result;
        });
        assert.deepEqual(privacyAndAccounts,{accountIsolation:true,revokedClearsImmediately:true,lateRevokedSummaryHidden:true});
        const unknownConfiguration=await page.evaluate(async()=>{
          const {renderRiskWorkbench}=await import('/nova/risk-workbench-view.mjs');
          const response=await fetch('/api/risk-workbench?account=pool',{headers:{'X-Fixture-Role':'edit'}}).then(res=>res.json());
          response.result.rules={policyConfigured:null,policyVersion:null,rules:[
            {label:'不可读配置的限额',configurationStatus:'unknown',enabled:false,limit:null,used:null,remaining:null,evidenceStatus:'missing'},
            {label:'校验失败的限额',configurationStatus:'invalid',enabled:false,limit:null,used:null,remaining:null,evidenceStatus:'conflict'}]};
          response.result.runtime={privateChannel:'unknown'};
          const node=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>response});document.getElementById('mount').replaceChildren(node);
          await new Promise(resolve=>setTimeout(resolve,0));
          const panel=[...node.querySelectorAll('section')].find(e=>e.querySelector('h2')?.textContent==='当前账户实际生效规则');
          const result={unknown:panel.textContent.includes('配置版本未知')&&panel.textContent.includes('配置未知'),
            invalid:panel.textContent.includes('配置未通过验证'),notUnconfigured:!panel.textContent.includes('未配置 / 未启用')};
          node.dispose();return result;
        });
        assert.deepEqual(unknownConfiguration,{unknown:true,invalid:true,notUnconfigured:true});
        const connectivityIsolation=await page.evaluate(async()=>{
          const {renderRiskWorkbench,createRiskSummary}=await import('/nova/risk-workbench-view.mjs');
          const response=await fetch('/api/risk-workbench?account=pool',{headers:{'X-Fixture-Role':'edit'}}).then(res=>res.json());
          const flush=()=>new Promise(resolve=>setTimeout(resolve,0)),results={};
          for(const kind of ['summary','workbench']){
            const lifetime=new AbortController(),pending=[];let role='edit';
            const ctx={get role(){return role;},signal:lifetime.signal,navigate:()=>{},onState:()=>{},
              api:(_path,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}))};
            const node=kind==='summary'?createRiskSummary(ctx,{autoload:false}):renderRiskWorkbench(ctx);
            document.getElementById('mount').replaceChildren(node);
            const refresh=()=>kind==='summary'?void node.refresh():[...node.querySelectorAll('button')].find(b=>b.textContent==='刷新风险').click();
            if(kind==='summary')refresh();await flush();
            pending.shift().resolve(response);await flush();
            const initialVisible=Boolean(node.querySelector('[data-risk-id]'));
            window.dispatchEvent(new Event('offline'));
            const offlineCleared=!node.querySelector('[data-risk-id]')&&!node.textContent.includes('核验时点权益');
            refresh();await flush();const offlineNoReads=pending.length===0;
            window.dispatchEvent(new Event('online'));await flush();
            const reconnectReadsFresh=pending.length===1&&!node.querySelector('[data-risk-id]');
            pending.shift().resolve(response);await flush();
            const restored=Boolean(node.querySelector('[data-risk-id]'));
            refresh();await flush();const old=pending.shift();
            window.dispatchEvent(new Event('offline'));old.resolve(response);await flush();
            const lateOfflineRejected=old.signal.aborted&&!node.querySelector('[data-risk-id]');
            window.dispatchEvent(new Event('online'));await flush();pending.shift().resolve(response);await flush();
            refresh();await flush();const beforeHide=pending.shift();
            window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));beforeHide.resolve(response);await flush();
            const pageHideCleared=beforeHide.signal.aborted&&!node.querySelector('[data-risk-id]');
            window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));await flush();
            const pageShowReadsFresh=pending.length===1;pending.shift().resolve(response);await flush();
            const pageShowRestored=Boolean(node.querySelector('[data-risk-id]'));
            window.dispatchEvent(new Event('offline'));role='view';window.dispatchEvent(new Event('online'));await flush();
            const revokedNoReads=pending.length===0&&!node.querySelector('[data-risk-id]');
            role='edit';lifetime.abort();
            window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow'));await flush();
            const disposedListeners=pending.length===0&&!node.querySelector('[data-risk-id]');
            node.dispose();
            results[kind]={initialVisible,offlineCleared,offlineNoReads,reconnectReadsFresh,restored,
              lateOfflineRejected,pageHideCleared,pageShowReadsFresh,pageShowRestored,revokedNoReads,disposedListeners};
          }
          return results;
        });
        for(const [kind,checks] of Object.entries(connectivityIsolation))for(const [name,passed] of Object.entries(checks))
          assert.equal(passed,true,kind+' '+name+' must not retain or revive stale private risk evidence');
        views.push({...viewport,matchingRiskId:riskId,accountIsolation:true,staleUnknown:true,muteKeepsRestriction:true,
          categoryMuteRestored:true,failedReadClearsReport:true,viewerPrivateReads:0,realNetworkOffline:true,requestIsolation,privacyAndAccounts,unknownConfiguration,connectivityIsolation});
      }finally{await page.close();}
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    for(const [file,bytes] of authoritativeFiles)assert.deepEqual(fs.readFileSync(path.join(f.root,file)),bytes,'UI cannot mutate original accounts');
    assert.deepEqual([...new Set(requests.filter(row=>row.method!=='GET').map(row=>row.path))],['/api/risk-workbench/alerts']);
    const report={passed:true,fixtureOnly:true,originalAuthorityUnchanged:true,realMessagesSent:0,views};
    fs.writeFileSync(path.join(output,'risk-browser-report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({output,...report},null,2)+'\n');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));for(const clean of cleanups)clean();}
}
main().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
