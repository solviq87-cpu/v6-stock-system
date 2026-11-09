#!/usr/bin/env node
'use strict';
// Optional Playwright layout QA. Fixture data is restricted to this loopback
// harness: it never starts the trading service or changes production data.
// V6_UI_BROWSER: optional Chromium executable; V6_UI_FONT_DIR: optional
// @fontsource/noto-sans-sc package for Chinese glyphs on minimal Linux hosts.
// Screenshots are opt-in and should remain local QA files, not account evidence.
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const os=require('os');
const root=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-ui-browser-')),fontDir=process.env.V6_UI_FONT_DIR;fs.mkdirSync(output,{recursive:true});
const sample={observedAt:Date.now(),indexObservedAt:Date.now(),source:'UI布局测试样本 · 非真实行情',indices:[['1.000001',3078.56,.62],['0.399001',9692.34,.78],['0.399006',1930.21,1.1],['1.000688',879.36,1.43]].map(([code,price,pct])=>({code,price,pct})),counts:{candidates:28,focused:10,signals:6,risk:12},mood:{upRatio:74,label:'震荡偏强',note:'趋势向上 · 资金活跃 · 可积极关注'},strategies:[['十四条选股',6],['八字口诀',7],['GPT 五策略',9],['Python 三轮筛选',8]].map(([label,count])=>({label,count})),rows:['贵州茅台','宁德时代','五粮液','药明康德','比亚迪','中国中免','东方财富','招商银行','美的集团','阳光电源'].map((name,i)=>({code:['600519','300750','000858','603259','002594','601888','300059','600036','000333','300274'][i],name,price:[1784.5,269.8,169.3,88.76,258.4,114.2,18.76,34.21,61.5,113.6][i],pct:1.26+i*.13,score:96.8-i*.6,signals:['趋势突破 + 资金流入'],explanation:['UI测试样本，非真实策略证据'],fourteen:i%2===0,bazi:i%2?{verdict:'研究样本'}:null}))};
const server=http.createServer((req,res)=>{let f=path.join(root,new URL(req.url,'http://local').pathname==='/m'?'mobile.html':new URL(req.url,'http://local').pathname);if(fontDir&&req.url.startsWith('/__qa-font/'))f=path.join(fontDir,new URL(req.url,'http://local').pathname.replace('/__qa-font/',''));if(req.url==='/')f=path.join(root,'index.html');try{let bytes=fs.readFileSync(f);if(f.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html');res.end(bytes)}catch{res.statusCode=404;res.end()}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.V6_UI_BROWSER||undefined,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});const report=[];try{for(const [label,width,height,url] of [['desktop-1366',1366,768,'/'],['desktop-1536',1536,864,'/'],['desktop-1920',1920,1080,'/'],['mobile-reference-1024',1024,1536,'/m'],['phone-320',320,568,'/m'],['phone-375',375,812,'/m'],['phone-390',390,844,'/m'],['phone-393',393,852,'/m'],['phone-430',430,932,'/m']]){const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/kline?**',r=>r.fulfill({json:{ok:true,asOf:'UI-test-only',rows:Array.from({length:35},(_,i)=>({date:'test-'+i,open:200+i*2,close:201+i*2,high:204+i*2,low:198+i*2,volume:100+i*10}))}}));await page.goto(`http://127.0.0.1:${server.address().port}${url}`);if(fontDir)await page.addStyleTag({content:fs.readFileSync(path.join(fontDir,'400.css'),'utf8').replaceAll('./files/','/__qa-font/files/')+fs.readFileSync(path.join(fontDir,'700.css'),'utf8').replaceAll('./files/','/__qa-font/files/')+'body .vx-shell,body .vx-dashboard,body .vx-mobile-dock{font-family:"Noto Sans SC",sans-serif!important}'});await page.evaluate(s=>{window.__v6Dashboard=s;const app=document.getElementById('app');if(app)app.style.display='block'},sample);await page.addScriptTag({path:path.join(root,'assets/terminal-dashboard.js')});await page.evaluate(s=>{s.indexObservedAt+=1000;s.indices.forEach(q=>q.price+=1);dispatchEvent(new CustomEvent('v6-dashboard-data',{detail:s}))},sample);await page.waitForTimeout(200);const metrics=await page.evaluate(()=>({offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>({cls:e.className,right:e.getBoundingClientRect().right})),bodyWidth:document.body.scrollWidth,viewport:innerWidth,dashboard:document.getElementById('vx-dashboard').getBoundingClientRect().toJSON(),panelCount:document.querySelectorAll('.vx-market-strip>.vx-panel').length,nav:document.querySelector('.vx-topbar').getBoundingClientRect().toJSON(),table:document.getElementById('vx-ranking').getBoundingClientRect().toJSON(),detail:document.querySelector('.vx-detail-column').getBoundingClientRect().toJSON(),
  regions:(()=>{const box=q=>{const e=document.querySelector(q);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(e).display};};
    return {indices:[...document.querySelectorAll('.vx-index-grid>.vx-index')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,display:getComputedStyle(e).display};}),
      market:box('.vx-market-strip'),mood:box('.vx-market-strip>.vx-mood'),moodScore:box('.vx-gauge strong'),moodCaption:box('.vx-mood>small'),environment:box('.vx-market-strip>.vx-environment'),risk:box('.vx-market-strip>.vx-risk-panel'),
      ranking:box('#vx-ranking'),chart:box('.vx-chart-panel'),chartCanvas:box('#vx-chart'),chartSvg:box('#vx-chart>svg'),explanation:box('.vx-explanation'),dock:box('.vx-mobile-dock'),brand:box('.vx-brand'),sidebar:box('.vx-sidebar')};
  })(),dockCount:document.querySelectorAll('.vx-mobile-dock>a').length,brandText:document.querySelector('.vx-brand')?.textContent||''}));if(process.env.V6_UI_SCREENSHOTS==='1')await page.screenshot({path:path.join(output,label+'.png')});console.log(label,JSON.stringify(metrics));assert.deepEqual(errors,[],label+' JS errors');assert.ok(metrics.bodyWidth<=width+1,label+' body overflow '+metrics.bodyWidth);
assert.match(metrics.brandText,/天枢智策/,label+' must keep the configured brand');
assert.equal(await page.locator('#vx-rows tr').count(),10);
const b=metrics.regions,within=(r,id)=>{assert.ok(r,id+' missing');assert.ok(r.left>=-2&&r.right<=width+2,label+' '+id+' horizontally clipped: '+JSON.stringify(r));};
within(b.market,'market strip');within(b.ranking,'ranking');
if(url==='/m'){
  assert.ok(b.moodScore&&b.moodCaption,label+' missing sentiment score or caption');
  assert.ok(b.moodScore.bottom<=b.moodCaption.top+2,label+' sentiment percentage overlaps explanation: '+JSON.stringify({score:b.moodScore,caption:b.moodCaption}));
}
if(label==='mobile-reference-1024'){
  assert.ok(b.dock&&b.chart&&b.explanation,label+' missing dock or stock-detail cards');
  assert.ok(Math.abs(b.chart.top-b.explanation.top)<=2,label+' original chart and explanation must start on same row');
  assert.ok(Math.abs(b.chart.bottom-b.explanation.bottom)<=2,label+' original chart and explanation must share one outer card');
  assert.ok(b.chart.bottom<=b.dock.top-12,label+' reference 1024 screenshot: stock detail is concealed behind the fixed dock: '+JSON.stringify({chart:b.chart,dock:b.dock}));
  assert.ok(b.chartCanvas&&b.chartSvg,label+' missing K-line plot');
  assert.ok(b.chartCanvas.height>=175&&b.chartSvg.height>=167,label+' visible K-line too small compared with original photo: '+JSON.stringify({canvas:b.chartCanvas,svg:b.chartSvg}));
}
if(width<=430){
  assert.equal(metrics.dockCount,7,label+' dock must have exactly seven real links');
  within(b.dock,'seven-item dock');within(b.chart,'K-line chart');within(b.explanation,'AI explanation');within(b.risk,'risk card');within(b.brand,'brand');
  const visible=b.indices.filter(q=>q.display!=='none'&&q.width>0);
  assert.equal(visible.length,3,label+' must show three mobile indices');
  for(const q of visible)within(q,'mobile index');
  assert.ok(visible[0].right<=visible[1].left+2&&visible[1].right<=visible[2].left+2,label+' indices must not overlap');
  assert.ok(Math.abs(visible[0].top-visible[2].top)<=2,label+' three indices must share one row');
  within(b.mood,'sentiment');within(b.environment,'market regime');
  assert.ok(Math.abs(b.mood.top-b.environment.top)<=2&&b.mood.right<=b.environment.left+2,label+' sentiment/regime need readable neighboring columns');
  assert.ok(b.risk.top>=Math.max(b.mood.bottom,b.environment.bottom)-2,label+' risk should be a full-width row below sentiment and regime');
  assert.ok(b.risk.width>=width-45,label+' risk too narrow; Chinese copy may become vertical');
  assert.ok(b.chart.width>=width-45,label+' chart must use a readable full-width mobile card');
  assert.ok(b.chart.bottom<=b.explanation.top+2,label+' K-line and explanation must stack on narrow phones');
  assert.ok(b.dock.bottom<=height+2&&b.dock.top>=height-160,label+' fixed dock must stay at bottom');
}else if(url==='/'){
  within(b.sidebar,'desktop sidebar');within(b.chart,'desktop chart');
  assert.ok(b.sidebar.width>=180&&b.sidebar.width<=220,label+' desktop left rail width');
  assert.ok(b.ranking.right<=b.chart.left+3,label+' ranking and chart should sit side by side');
  assert.ok(b.indices.filter(q=>q.display!=='none'&&q.width>0).length===4,label+' desktop shows four indices');
}await page.locator('[data-vx-filter="bazi"]').last().click();assert.equal(await page.locator('#vx-rows tr').count(),5);report.push({label,...metrics,errors});await page.close()}}finally{await browser.close();await new Promise(r=>server.close(r));}fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));})().catch(e=>{console.error(e);server.close();process.exitCode=1});
