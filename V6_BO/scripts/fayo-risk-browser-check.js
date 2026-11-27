#!/usr/bin/env node
'use strict';
// Real authority -> derived risk journal -> native browser, entirely isolated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {fixture,BASE}=require('../tests/helpers/account-equity-fixture');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const {VERSION:stateVersion}=require('../src/core/risk-state-contract');
const {createRiskAlertLifecycle,MAX_DAILY_SENDS}=require('../src/core/risk-alert-lifecycle');
const {riskRow}=require('../src/core/risk-workbench');
const publicRoot=path.resolve(__dirname,'../public');
const output=process.env.FAYO_RISK_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-risk-browser-'));
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),day='2026-11-23',calendar={isOpen:()=>true};
fs.mkdirSync(output,{recursive:true});
f.buy('600000',100,10);f.buy('600001',100,10);
f.service.submit({orderId:'risk-ui-pending',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:day});
f.service.configure({expectedRevision:f.service.read().revision,riskPolicy:{version:'risk-ui-original-policy-v1',maxGrossExposurePct:1}});
const pre=createPaperApplicationService({file:path.join(f.root,'pre.json'),clock:()=>f.now,calendar});pre.initialize(500000);
let stale=false,unavailable=false,policyUnavailable=false;
const runtime=createRiskWorkbenchRuntime({root:path.join(f.root,'derived'),clock:()=>f.now,isPrimary:()=>true,planEnabled:()=>true,
  readBook:key=>key==='pool'?f.service.read():pre.read(),readQuotes:()=>Object.fromEntries(['600000','600001'].map(code=>[code,
    f.quote(code,10,{timestamp:f.now-(stale?16000:0),quoteAt:f.now-(stale?16000:0),receivedAt:f.now,tradeDate:day})])),
  readResearch:()=>({market:{quotes:{total:2,recent:stale?0:2},receivedAt:f.now},supports:[],contra:[],missing:[],
    manualHoldings:{status:'unconfigured',positions:[],alerts:[]},strategyDecay:{status:'unknown',reason:'独立成熟样本不足，校准状态未知'}}),
  readPlans:async()=>({ok:true,state:{plans:[]}}),readObservations:async()=>({records:[],alerts:[]}),
  readAutomaticPolicy:()=>{if(policyUnavailable)throw Error('isolated policy module failure');
    return {maxPos:5,sl:-.03,tp:.08,expireDays:4};},readOriginalExitChecks:()=>({}),
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
        stale=false;policyUnavailable=false;await page.evaluate(()=>window.showRisk());
        await page.locator('[data-risk-root="rule/maxGrossExposurePct"]').waitFor();
        const text=await page.locator('#mount').innerText();
        assert.match(text,/未成交买单敞口/);assert.match(text,/1,000/);assert.match(text,/核验时点权益/);
        assert.match(text,/已结算盈亏/);assert.match(text,/持仓浮盈亏/);assert.match(text,/连续全账户最大回撤/);
        assert.match(text,/未配置 \/ 未启用/);assert.match(text,/网关受理仍未证明接收端收到/);
        assert.equal(await page.locator('[data-risk-severity="critical"]').count(),1);
        const root=page.locator('[data-risk-root="rule/maxGrossExposurePct"]'),riskId=await root.getAttribute('data-risk-id');
        assert.equal(await root.getAttribute('data-risk-level'),'3');
        assert.equal(await root.getAttribute('data-risk-assessment'),'risk-detected');
        assert.equal(await root.getAttribute('data-risk-contract'),stateVersion);
        assert.match(await root.innerText(),/三级：风险触发/);assert.match(await root.innerText(),/证据完整/);
        assert.match(await root.innerText(),/数据有效/);assert.match(await root.innerText(),/动作被阻止/);
        assert.match(await root.innerText(),/原提醒：关键风险/);
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
        const missing=page.locator('[data-risk-root="rule/maxGrossExposurePct"]');
        assert.equal(await missing.getAttribute('data-risk-assessment'),'unable-to-assess');
        assert.equal(await missing.getAttribute('data-risk-level'),'');
        assert.equal(await missing.getAttribute('data-risk-contract'),stateVersion);
        assert.equal(await missing.getAttribute('data-risk-id'),riskId);
        assert.match(await missing.innerText(),/上次有效风险：三级：风险触发/);
        assert.match(await missing.innerText(),/原风险未解除/);
        await missing.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,'risk-stale-'+viewport.width+'.png'),fullPage:false});
        stale=false;policyUnavailable=true;await page.getByRole('button',{name:'刷新风险',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('[data-risk-root="rule/maxGrossExposurePct"]')?.textContent.includes('原模块未返回'));
        assert.equal(await missing.getAttribute('data-risk-id'),riskId);
        assert.match(await missing.innerText(),/上次有效风险：三级：风险触发/);
        await page.evaluate(()=>window.showRisk('home'));
        const retainedHome=page.locator('[data-risk-root="rule/maxGrossExposurePct"]');await retainedHome.waitFor({state:'visible'});
        assert.equal(await retainedHome.getAttribute('data-risk-id'),riskId);
        assert.equal(await retainedHome.getAttribute('data-risk-assessment'),'unable-to-assess');
        assert.match(await retainedHome.innerText(),/原模块未返回|原风险未解除/);
        policyUnavailable=false;
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
        // Exercise the existing shared view at both desktop and mobile widths.
        // All responses are local fixtures; a rejected old control never sends
        // a request to the original notification endpoint.
        const receiptIsolation=await page.evaluate(async()=>{
          const {renderRiskWorkbench,createRiskSummary}=await import('/nova/risk-workbench-view.mjs');
          const get=q=>fetch('/api/risk-workbench?'+q,{headers:{'X-Fixture-Role':'edit'}}).then(r=>r.json());
          const [pool,pre,stock]=await Promise.all([get('account=pool'),get('account=pre'),get('account=pool&code=600000')]);
          const flush=()=>new Promise(resolve=>setTimeout(resolve,0)),mount=document.getElementById('mount');
          let requests=0;
          const summary=createRiskSummary({role:'edit',navigate:()=>{},api:async()=>{requests++;return stock;}},{autoload:false});
          mount.replaceChildren(summary);
          await summary.refresh({code:'600001'});
          const wrongCodeRejected=!summary.querySelector('[data-risk-id]')&&summary.textContent.includes('完整风险回执');
          const scope=new AbortController();
          await summary.refresh({code:'600000',signal:scope.signal});
          const initial=!!summary.querySelector('[data-risk-id]');
          scope.abort();const count=requests;window.dispatchEvent(new Event('online'));await flush();
          const completedScopeCleared=initial&&summary.hidden&&!summary.querySelector('[data-risk-id]')&&requests===count;
          summary.dispose();
          const pending=[],posts=[];
          const node=renderRiskWorkbench({role:'edit',navigate:()=>{},api:(url,options)=>{
            if(options.method==='POST'){posts.push(options.body);return Promise.resolve({ok:true});}
            return new Promise(resolve=>pending.push(resolve));
          }});
          mount.replaceChildren(node);await flush();pending.shift()(pool);await flush();
          const oldButton=[...node.querySelectorAll('button')].find(x=>x.textContent==='关键风险静音30分钟'||x.textContent==='恢复关键风险通知');
          const chooser=node.querySelector('[aria-label="风险账户"]');chooser.value='pre';chooser.dispatchEvent(new Event('change'));
          pending.shift()(pre);await flush();oldButton?.click();await flush();
          const oldControlRejected=!!oldButton&&posts.length===0;
          node.dispose();
          const stale=structuredClone(pool),r=stale.result;
          // Use a small remaining source-age window to exercise the actual
          // expiry timer without waiting 15 seconds per viewport.
          const mark=r.equity?.positions?.find(p=>p.evidenceStatus==='available'&&p.quote);
          if(!mark)throw Error('缺少隔离估值fixture');
          mark.quote.quoteAt=r.generatedAt-14000;
          const idle=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>stale});
          mount.replaceChildren(idle);await flush();const visible=idle.textContent.includes('账户权益与观察回撤');
          await new Promise(resolve=>setTimeout(resolve,1100));
          const idleExpired=visible&&!idle.querySelector('[data-risk-id]')&&!idle.textContent.includes('账户权益与观察回撤')&&idle.textContent.includes('原风险未解除');
          idle.dispose();
          const wrong=structuredClone(pool),w=wrong.result,e=w.equity;
          if(!w.stress||!e)throw Error('缺少隔离压力fixture');
          const ext={protocol:'fayo-adverse-path-research-v1',accountId:'pre',accountEpoch:w.accountEpoch,
            accountRevision:w.accountRevision,equityEvidenceId:e.fingerprint,authoritySnapshotFingerprint:e.source.snapshotFingerprint,
            asOf:w.generatedAt,researchOnly:true,canTrade:false,canNotify:false,writesAccount:false,accountMutated:false,
            executionGuaranteed:false,maximumLossGuarantee:false,status:'estimated',paths:[],note:'C11-wrong-account-marker'};
          w.stress.adversePaths=ext;
          const projected=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>wrong});
          mount.replaceChildren(projected);await flush();
          const mixedResearchRejected=projected.textContent.includes('账户权益与观察回撤')&&!projected.textContent.includes('C11-wrong-account-marker');
          projected.dispose();
          return {wrongCodeRejected,completedScopeCleared,oldControlRejected,idleExpired,mixedResearchRejected};
        });
        for(const [name,passed] of Object.entries(receiptIsolation))assert.equal(passed,true,name+' must retain the original account/read scope');
        // C12: replay/visibility/notification isolation with the original
        // workbench, at every existing desktop/mobile test viewport.
        const replayAndActions=await page.evaluate(async()=>{
          const {renderRiskWorkbench}=await import('/nova/risk-workbench-view.mjs');
          const get=q=>fetch('/api/risk-workbench?'+q,{headers:{'X-Fixture-Role':'edit'}}).then(r=>r.json());
          const [pool,pre]=await Promise.all([get('account=pool'),get('account=pre')]);
          const flush=()=>new Promise(resolve=>setTimeout(resolve,0)),mount=document.getElementById('mount');
          const refresh=node=>[...node.querySelectorAll('button')].find(x=>x.textContent==='刷新风险').click();
          const category=node=>[...node.querySelectorAll('button')].find(x=>x.textContent==='关键风险静音30分钟'||x.textContent==='恢复关键风险通知');
          const aged=structuredClone(pool),r=aged.result,mark=r.equity?.positions?.find(p=>p.evidenceStatus==='available'&&p.quote);
          if(!mark)throw Error('缺少本地估值fixture');
          mark.quote.quoteAt=r.generatedAt-14000;
          const cached=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>aged});
          mount.replaceChildren(cached);await flush();
          const initial=cached.textContent.includes('账户权益与观察回撤');
          await new Promise(resolve=>setTimeout(resolve,1100));refresh(cached);await flush();
          const replayRejected=initial&&!cached.textContent.includes('账户权益与观察回撤')&&cached.textContent.includes('原风险未解除');
          cached.dispose();

          let reads=0,vis='visible';const desc=Object.getOwnPropertyDescriptor(document,'visibilityState');
          Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>vis});
          const emit=next=>{vis=next;document.dispatchEvent(new Event('visibilitychange'));};
          const backgrounded=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>{reads++;return pool;}});
          mount.replaceChildren(backgrounded);await flush();
          emit('hidden');const count=reads;refresh(backgrounded);await flush();
          const hiddenInvalidated=!backgrounded.querySelector('[data-risk-id]')&&reads===count;
          emit('visible');await flush();
          const foregroundReread=reads===count+1&&backgrounded.textContent.includes('账户权益与观察回撤');
          backgrounded.dispose();if(desc)Object.defineProperty(document,'visibilityState',desc);else delete document.visibilityState;

          const mixed=structuredClone(pool);
          if(!mixed.result.alerts)throw Error('缺少原提醒fixture');
          mixed.result.alerts.accountId='pre';
          if(mixed.result.alerts.groups.length){
            const g=mixed.result.alerts.groups[0];g.rootCauseId='C12-mixed-alert-marker';
            if(g.risks?.length)g.risks[0].facts=['C12-mixed-alert-marker'];
          }
          let wrongPosts=0;
          const wrong=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async(url,options)=>{if(options.method==='POST'){wrongPosts++;return {ok:true};}return mixed;}});
          mount.replaceChildren(wrong);await flush();
          const disabled=category(wrong);disabled?.click();await flush();
          const wrongAlertsRejected=!!disabled&&disabled.disabled&&wrongPosts===0&&!wrong.textContent.includes('C12-mixed-alert-marker')&&wrong.textContent.includes('账户权益与观察回撤');
          wrong.dispose();

          const requests=[];let pendingPost=null,readCount=0;
          const guarded=renderRiskWorkbench({role:'edit',navigate:()=>{},api:(url,options)=>{
            if(options.method==='POST'){requests.push(options.body);return new Promise(resolve=>{pendingPost=resolve;});}
            readCount++;return Promise.resolve(url.includes('account=pre')?pre:pool);
          }});
          mount.replaceChildren(guarded);await flush();
          const button=category(guarded);button?.click();button?.click();
          const root=[...guarded.querySelectorAll('button')].find(x=>x.textContent==='标为已查看'||x.textContent==='已查看');
          root?.click();const singleInFlight=!!button&&requests.length===1&&requests[0].accountId==='pool';
          const chooser=guarded.querySelector('[aria-label="风险账户"]');chooser.value='pre';chooser.dispatchEvent(new Event('change'));await flush();
          const before=readCount;pendingPost?.({ok:true});await flush();
          const oldCompletionIsolated=readCount===before&&guarded.textContent.includes(pre.result.account.label);
          guarded.dispose();

          const unknown=structuredClone(pool),risk=unknown.result.risks[0];
          if(!risk)throw Error('缺少原风险fixture');
          Object.assign(risk,{priceDependent:true,dataState:'valid',sourceAt:unknown.result.generatedAt,riskContract:{...risk.riskContract,dataAt:null}});
          const badClock=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>unknown});
          mount.replaceChildren(badClock);await flush();
          const explicitUnknownRejected=!badClock.textContent.includes('账户权益与观察回撤')&&badClock.textContent.includes('原风险未解除');
          badClock.dispose();
          return {replayRejected,hiddenInvalidated,foregroundReread,wrongAlertsRejected,singleInFlight,oldCompletionIsolated,explicitUnknownRejected};
        });
        for(const [name,passed] of Object.entries(replayAndActions))assert.equal(passed,true,name+' must preserve original risk and alert identity');
        // C19 consumer contract: a synthetic optional C18 projection in the
        // existing read-only view. The older producer may omit this field.
        // No receiver callback or real notification is created by this check.
        const notificationHistory=await page.evaluate(async()=>{
          const {renderRiskWorkbench}=await import('/nova/risk-workbench-view.mjs');
          const get=q=>fetch('/api/risk-workbench?'+q,{headers:{'X-Fixture-Role':'edit'}}).then(r=>r.json());
          const [pool,pre]=await Promise.all([get('account=pool'),get('account=pre')]);
          const f=structuredClone(pool),r=f.result,a=r.alerts;
          if(!a?.groups?.length)throw Error('原提醒fixture缺失');
          a.receiverConfirmationSupported=false;
          const g=a.groups[0],events=g.events.slice(-16);
          const rows=events.map(e=>({eventId:e.id,kind:e.kind,eventRecordedAt:e.at,status:'not-queued',deliveryId:null,
            reservedAt:null,reservationDelayMs:null,firstReceiptRecordedAt:null,lastReceiptRecordedAt:null,gatewayAcceptedReceiptAt:null,
            conflictingGatewayReceipts:false,receiverReceivedAt:null,receiverReceiptRecordedAt:null,receiverObservationDelayMs:null,
            actualUserActionAt:null,actualExecutableExitAt:null,actualAvoidedLoss:null}));
          g.notification={status:'not-queued',deliveryId:null,receiverConfirmed:false,gatewayAccepted:false};
          g.notificationEventId=events.at(-1).id;
          g.notificationReview={totalEvents:g.events.length,shownEvents:rows.length,omittedEvents:g.events.length-rows.length,
            rows,canTrade:false,receiverConfirmationSupported:false,actualWarningEffectCertified:false};
          const flush=()=>new Promise(resolve=>setTimeout(resolve,0)),mount=document.getElementById('mount');
          const check=node=>node.querySelector('#risk-notification-history');
          let posts=0;
          const valid=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async(url,options)=>{
            if(options.method==='POST'){posts++;return {ok:false};}
            return url.includes('account=pre')?pre:f;
          }});
          mount.replaceChildren(valid);await flush();
          const p=check(valid),entry=p?.querySelector('[data-risk-history-event]');
          const sameArchive=!!entry&&entry.getAttribute('data-risk-history-event')===events[0].id&&p.textContent.includes('未排队')&&
            p.textContent.includes('实际用户行动、可执行退出及减少损失：未知')&&p.querySelectorAll('button').length===0;
          const chooser=valid.querySelector('[aria-label="风险账户"]');chooser.value='pre';chooser.dispatchEvent(new Event('change'));await flush();
          const switched=!check(valid)?.querySelector('[data-risk-history-event="'+events[0].id+'"]');
          valid.dispose();
          const bad=structuredClone(f);bad.result.alerts.groups[0].notificationReview.rows[0].eventId='f'.repeat(64);
          const invalid=renderRiskWorkbench({role:'edit',navigate:()=>{},api:async()=>bad});
          mount.replaceChildren(invalid);await flush();
          const mismatchUnknown=!!check(invalid)&&!check(invalid).querySelector('[data-risk-history-event="'+events[0].id+'"]')&&
            check(invalid).textContent.includes('时间链未知')&&invalid.textContent.includes('账户权益与观察回撤');
          invalid.dispose();
          const denied=renderRiskWorkbench({role:'view',navigate:()=>{},api:async()=>{throw Error('viewer must not read');}});
          mount.replaceChildren(denied);await flush();
          const viewerHidden=!check(denied)&&posts===0;
          return {sameArchive,switched,mismatchUnknown,viewerHidden};
        });
        for(const [name,passed] of Object.entries(notificationHistory))assert.equal(passed,true,name+' must preserve historical receipt scope');
        views.push({...viewport,receiptIsolation,replayAndActions,notificationHistory,matchingRiskId:riskId,accountIsolation:true,staleUnknown:true,muteKeepsRestriction:true,
          categoryMuteRestored:true,failedReadClearsReport:true,viewerPrivateReads:0,realNetworkOffline:true,requestIsolation,privacyAndAccounts,unknownConfiguration,connectivityIsolation,stateVersion,
          fourDimensions:true,lastValidLevel:3,staleNeverCleared:true,omittedUpstreamKeepsHomeRisk:true});
      }finally{await page.close();}
    }
    // Exercise a real bounded admission refusal, then read its normal API/UI
    // projection. These are isolated reservations; no transport is enabled.
    stale=false;
    const current=await runtime.read({accountId:'pool'}),key={accountId:'pool',accountEpoch:current.accountEpoch};
    const lifecycle=createRiskAlertLifecycle({root:path.join(f.root,'derived','notifications'),clock:()=>f.now,canWrite:()=>true});
    let state=lifecycle.read(key);
    lifecycle.setMuted({...key,rootCauseId:'rule/maxGrossExposurePct',actor:'isolated-browser',expectedRevision:state.revision,mutedUntil:null});
    for(let index=0;index<MAX_DAILY_SENDS;index++){
      const row=riskRow({rootCauseId:'isolated-quota/'+index,category:'system',object:{type:'account',id:'pool'},
        severity:'critical',evidenceStatus:'available',source:'isolated-browser-quota',sourceAt:f.now,status:'active',
        facts:['隔离配额验证记录'],impact:'仅验证通知预留上限'},f.now);
      lifecycle.observe({...key,risks:[row],observedAt:f.now,complete:false});
      assert.equal(lifecycle.reserveDelivery({...key,rootCauseId:row.rootCauseId}).reserved,true);
    }
    assert.equal(lifecycle.reserveDelivery({...key,rootCauseId:'rule/maxGrossExposurePct'}).status,'daily-limit');
    const quotaPage=await browser.newPage({viewport:{width:390,height:844}});
    try{
      quotaPage.on('pageerror',error=>errors.push(error.message));
      await quotaPage.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
      await quotaPage.goto(origin+'/m');
      await quotaPage.evaluate(async()=>{
        const {renderRiskWorkbench}=await import('/nova/risk-workbench-view.mjs');
        const node=renderRiskWorkbench({role:'edit',onState:()=>{},api:async url=>
          (await fetch(url,{headers:{'X-Fixture-Role':'edit'}})).json()});
        document.getElementById('mount').replaceChildren(node);
      });
      const card=quotaPage.locator('[data-risk-root="rule/maxGrossExposurePct"]');
      await card.waitFor({state:'visible'});await card.locator('summary').click();
      assert.match(await card.innerText(),/未排队 · 已达每日限额/);
      assert.match(await card.innerText(),/本事件未排队、未发送/);
      assert.match(await card.innerText(),/尚无接收证据/);
      await card.scrollIntoViewIfNeeded();await quotaPage.screenshot({path:path.join(output,'risk-daily-limit-390.png'),fullPage:false});
    }finally{await quotaPage.close();}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.equal(views[0].matchingRiskId,views[1].matchingRiskId);
    assert.equal(views[0].stateVersion,views[1].stateVersion);
    for(const [file,bytes] of authoritativeFiles)assert.deepEqual(fs.readFileSync(path.join(f.root,file)),bytes,'UI cannot mutate original accounts');
    assert.deepEqual([...new Set(requests.filter(row=>row.method!=='GET').map(row=>row.path))],['/api/risk-workbench/alerts']);
    const report={passed:true,fixtureOnly:true,originalAuthorityUnchanged:true,realMessagesSent:0,dailyLimitVisible:true,views};
    fs.writeFileSync(path.join(output,'risk-browser-report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({output,...report},null,2)+'\n');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));for(const clean of cleanups)clean();}
}
main().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
