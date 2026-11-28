'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {createPaperPlanObservationStore}=require('../../src/core/paper-plan-observation-store');

// Optional native HTTP/browser extension of the original signal-to-veto test.
// Rebuild only the synthetic records made by that test in a fresh temporary host.
async function verify({extra,archive,output,decisionId}) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-notice-review-'));
  const root=path.resolve(__dirname,'../..'),now=Date.parse('2026-11-28T10:00:00+08:00');
  let server,browser;
  try {
    for(const name of ['src','public','strategies','package.json',...fs.readdirSync(root).filter(f=>f.endsWith('.js'))])
      fs.cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
    fs.mkdirSync(path.join(temp,'config'));
    for(const name of ['data-source-catalog.json','six-photo-sources.json'])
      fs.copyFileSync(path.join(root,'config',name),path.join(temp,'config',name));
    fs.writeFileSync(path.join(temp,'config/intelligence-center.json'),JSON.stringify({enabled:true}));
    const access={},devices={};
    for(const role of ['edit','view']){
      const token=crypto.randomBytes(32).toString('hex'),salt=crypto.randomBytes(16).toString('hex');
      const hash=crypto.createHash('sha256').update(token).digest('hex');
      const account={salt,hash:crypto.scryptSync('isolated-test-only',salt,32).toString('hex'),devices:{[hash]:{role,ts:now,name:'isolated'}}};
      if(role==='edit')Object.assign(access,account);else access.view=account;
      devices[role]=token;
    }
    fs.writeFileSync(path.join(temp,'access.json'),JSON.stringify(access));
    const observedAt=archive.records[0].observedAt;
    const store=createPaperPlanObservationStore({root:path.join(temp,'research','plan-observations'),clock:()=>observedAt,canWrite:()=>true});
    await store.append({records:archive.records,alerts:archive.alerts,now:observedAt});
    const log=[{ts:extra.planNotice.quoteAt+1000,status:'✅ 已送达(私密)',title:'隔离样本 · 原计划进入观察区',channel:'飞书·私密',extra},
      {ts:extra.planNotice.quoteAt-1,status:'✅ 已送达(私密)',title:'隔离样本 · 历史记录',extra:{signalRefs:extra.signalRefs}}];
    fs.writeFileSync(path.join(temp,'pushlog.json'),JSON.stringify(log));
    fs.writeFileSync(path.join(temp,'offline.cjs'),`require('node:test').mock.timers.enable({apis:['Date'],now:${now}});for(const n of ['node:http','node:https']){const m=require(n);m.request=m.get=()=>{throw Error('isolated outbound request');};}global.fetch=()=>Promise.reject(Error('isolated outbound fetch'));`);
    const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);
      s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    const origin='http://127.0.0.1:'+port;
    server=spawn(process.execPath,['--require',path.join(temp,'offline.cjs'),'server.js'],{cwd:temp,
      env:{PATH:process.env.PATH,HOME:temp,HOST:'127.0.0.1',PORT:String(port),QD_CLOUD:'1',
        V6_SHORTLINE_DIR:path.join(temp,'research'),V6_ISOLATED_BOOT_SMOKE:'1'},stdio:'ignore'});
    const url=origin+'/api/push-log?planNotice='+extra.planNotice.deliveryId;
    let ready=false;
    for(let i=0;i<100;i++){
      assert.equal(server.exitCode,null);
      try{if((await fetch(origin+'/api/lock/status')).ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(ready);
    async function read(token){return (await fetch(url,{headers:token?{Authorization:'Bearer '+token}:{}})).json();}
    const authorized=await read(devices.edit);
    assert.equal(authorized.result?.status,'historical',JSON.stringify(authorized));
    assert.equal(authorized.result.original.decisionId,decisionId);
    for(const token of ['',devices.view])assert.notEqual((await read(token)).ok,true);
    fs.mkdirSync(output,{recursive:true});
    browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
    const views=[];
    for(const [width,height,route] of [[1536,1000,'/'],[390,844,'/m']]){
      const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
      try {
        const page=await ctx.newPage(),external=[],writes=[],reviewResponses=[];
        await ctx.addInitScript(token=>{localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','edit');},devices.edit);
        await page.route('**/*',r=>{
          const req=r.request(),u=new URL(req.url());
          if(u.origin!==origin){external.push(u.hostname);return r.abort();}
          if(req.method()!=='GET'&&u.pathname.startsWith('/api/paper'))writes.push(u.pathname);
          return r.continue();
        });
        page.on('response',response=>{if(response.url()===url)reviewResponses.push(response.status());});
        await page.goto(origin+route+'#/inbox/push',{waitUntil:'domcontentloaded'});
        const panel=page.locator('details').filter({has:page.getByText('核对原计划与查看时状态',{exact:true})});
        await panel.locator('summary').click({timeout:12000});
        await panel.getByText('决策 ID '+decisionId,{exact:true}).waitFor({timeout:8000});
        assert.match(await panel.innerText(),/原触发.*600000.*10 元/);
        assert.match(await panel.innerText(),/时段或交易日/);
        assert.equal(await page.getByText(/历史通知缺少原计划投递凭据/).isVisible(),true);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        assert.ok(overflow<=1,'page overflow '+overflow);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
        assert.deepEqual(reviewResponses,[200]);
        await panel.screenshot({path:path.join(output,'计划通知-'+width+'.png')});
        views.push({route,width,height,overflow,reviewResponses,external,writes});
      }finally{await ctx.close();}
    }
    fs.writeFileSync(path.join(output,'native-http-browser.json'),JSON.stringify({synthetic:true,realDevice:false,liveDelivery:false,
      treeSource:'existing native server, archived synthetic condition and original Nova views',authorized:authorized.result,viewerAllowed:false,views},null,2));
  }finally{
    if(browser)await browser.close();
    if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGKILL');await stopped;}
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
module.exports={verify};
