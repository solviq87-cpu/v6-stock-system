#!/usr/bin/env node
'use strict';

// Exercises the native page against the real HTTP handler and archive worker;
// createFixture supplies owner-only temporary files and blocks upstream traffic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {crc32}=require('node:zlib');
const {chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');

async function check(browser,width){
 const f=await createFixture({count:1}),origin='http://127.0.0.1:'+f.port;
 const context=await browser.newContext({viewport:{width,height:880},serviceWorkers:'block'}),page=await context.newPage();
 const errors=[],writes=[],outbound=[];
 try{
  page.setDefaultTimeout(15000);
  await page.addInitScript(token=>localStorage.setItem('qd_device',token),f.token);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{
   if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/research/shortline'){
    const b=req.postDataJSON();writes.push({book:req.headers()['x-v6-research-book']||'main',action:b.action});
   }
  });
  await page.route('**/*',r=>{
   const url=new URL(r.request().url());
   if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){outbound.push(url.hostname);return r.abort();}
   return r.continue();
  });
  const select=page.getByRole('combobox',{name:'当前研究账户'}),sheet=page.locator('.sheet-body');
  await page.goto(origin+'/#/lab/shortline-setup',{waitUntil:'domcontentloaded'});
  await sheet.getByText('主研究账户 · 开始使用').waitFor();
  assert.match(await sheet.innerText(),/已有 0 根 K 线、0 笔交易、0 条校验/);
  assert.equal(await select.inputValue(),'main');
  const demoWrite=page.waitForResponse(resp=>resp.url().endsWith('/api/research/shortline')&&resp.request().method()==='POST'&&resp.request().postDataJSON()?.action==='book:demo');
  await sheet.locator('[data-seed]').click();const demoResult=await (await demoWrite).json();assert.equal(demoResult.ok,true);
  await page.waitForURL(/shortline-overview/);await page.locator('.shortline-overview').waitFor();
  assert.equal(await select.inputValue(),'demo');assert.ok(demoResult.state.bars.length>100);assert.ok(demoResult.state.trades.length>0);
  const demoDate=demoResult.state.trades[0].exitDate;
  await page.evaluate(date=>location.hash='#/lab/shortline-journal?date='+date+'&sample=all',demoDate);
  const zip=sheet.locator('[data-zip]');await zip.waitFor();assert.equal(await select.inputValue(),'demo');
  assert.equal(await sheet.locator('[data-j=end]').inputValue(),demoDate);
  const downloading=page.waitForEvent('download');await zip.click();const dl=await downloading;
  assert.equal(dl.suggestedFilename(),'V6-复盘-'+demoDate+'.zip');
  const bytes=fs.readFileSync(await dl.path()),directory=bytes.length-22;
  assert.equal(bytes.readUInt32LE(directory),0x06054b50);
  const files={};let offset=bytes.readUInt32LE(directory+16);
  for(let i=0;i<bytes.readUInt16LE(directory+10);i++){
   assert.equal(bytes.readUInt32LE(offset),0x02014b50);
   const n=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+46,offset+46+n).toString(),start=bytes.readUInt32LE(offset+42);
   const from=start+30+bytes.readUInt16LE(start+26)+bytes.readUInt16LE(start+28),size=bytes.readUInt32LE(offset+24);
   const content=bytes.subarray(from,from+size);assert.equal(crc32(content),bytes.readUInt32LE(offset+16));files[name]=content.toString();
   offset+=46+n+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
  }
  assert.deepEqual(Object.keys(files),['当日复盘.md','交易记录.csv','回测结果.csv','日志.csv']);
  assert.match(files['交易记录.csv'],/合成教学样本/);assert.match(files['交易记录.csv'],/测试样本/);
  await page.getByRole('button',{name:'账户与初始化',exact:true}).click();
  await sheet.getByText('演示库 · 开始使用').waitFor();await select.selectOption('main');
  await sheet.getByText('主研究账户 · 开始使用').waitFor();
  assert.match(await sheet.innerText(),/已有 0 根 K 线、0 笔交易、0 条校验/);
  await sheet.locator('[data-create]').click();
  await page.locator('dialog input[name=name]').fill('浏览器独立账户');
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await sheet.getByText('浏览器独立账户 · 开始使用').waitFor();
  const id=await select.inputValue();assert.match(id,/^book-[a-f0-9]{16}$/);
  await sheet.locator('[data-lock]').click();await sheet.getByRole('button',{name:'解除清空保护'}).waitFor();
  assert.equal(await sheet.locator('[data-reset]').isDisabled(),true);
  await sheet.locator('[data-lock]').click();await sheet.getByRole('button',{name:'锁定，禁止清空'}).waitFor();
  await sheet.locator('[data-reset]').click();
  await page.locator('dialog input[name=confirmation]').fill('清空主研究账户');
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await page.locator('dialog').getByText(/完整确认文字/).waitFor();
  await page.locator('dialog input[name=confirmation]').fill('清空浏览器独立账户');
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await page.locator('dialog').waitFor({state:'hidden'});
  await sheet.getByText('浏览器独立账户 · 开始使用').waitFor();assert.equal(await select.inputValue(),id);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  assert.equal(writes.filter(w=>w.action==='book:demo').length,1);
  assert.ok(writes.filter(w=>w.book==='demo').every(w=>w.action==='book:demo'));
  assert.ok(!outbound.length);assert.deepEqual(errors,[]);console.log(width+'px: actual private API, first load, demo, account isolation, reset protection and ZIP passed');
 }finally{await context.close();await f.close();}
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1366])await check(browser,width);}finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
