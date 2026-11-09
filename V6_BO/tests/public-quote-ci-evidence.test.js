'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/v6-public-quote-diagnostic.yml'),'utf8');

function inlineScript() {
  const begin=workflow.indexOf("          node - <<'NODE'\n");
  assert.ok(begin>=0);
  const start=begin+"          node - <<'NODE'\n".length;
  const end=workflow.indexOf("\n          NODE",start);
  assert.ok(end>start);
  const src=workflow.slice(start,end).split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  new vm.Script(src);
  return src;
}

test('manual quote workflow validates at read-time, not only raw HTTP connectivity',()=>{
  const src=inlineScript();
  assert.match(src,/projectProbe\(p,at\)/);
  assert.match(src,/quoteTime/);
  assert.match(src,/ageSeconds/);
  assert.match(src,/verifiedLive:false,canTrade:false/);
  assert.doesNotMatch(src,/\.quote\?\.price|console\.log\(p\)|fetch\(/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/tencent,eastmoney,sina/);
});

test('source evidence report preserves old quote timestamp and never emits a price, token or fake live flag',()=>{
  const src=inlineScript();
  const now=Date.parse('2026-11-09T10:30:00Z');
  const quoteAt=now-86400000;
  const outputs=[];
  let summary='';
  class Clock extends Date {static now(){return now;}}
  vm.runInNewContext(src,{
    Date:Clock,Math,JSON,
    process:{env:{GITHUB_STEP_SUMMARY:'/tmp/isolated-test-only.md'}},
    require:(name)=>{
      if(name==='fs')return {readFileSync:()=>JSON.stringify({code:'600519',secrets:'PRIVATE_TOKEN'}),
        appendFileSync:(p,body)=>{assert.equal(p,'/tmp/isolated-test-only.md');summary+=body;}};
      if(name==='./src/core/public-quote-probe')return {projectProbe:()=>({
        code:'600519',status:'snapshot-only',
        sources:[{id:'tencent',status:'dated-snapshot',quote:{
          quoteTime:new Date(quoteAt).toISOString(),quoteAt,price:9999,secret:'SECRET'}}]
      })};
      throw Error(name);
    },
    console:{log:v=>outputs.push(v)}
  });
  const out=JSON.parse(outputs.join(''));
  assert.equal(out.status,'snapshot-only');
  assert.equal(out.sources[0].status,'dated-snapshot');
  assert.equal(out.sources[0].ageSeconds,86400);
  assert.equal(out.sources[0].quoteAt,new Date(quoteAt).toISOString());
  assert.equal(out.verifiedLive,false);
  assert.equal(out.canTrade,false);
  assert.equal(out.sources[0].price,undefined);
  assert.match(summary,/原始报价时点/);
  assert.match(summary,/86400s/);
  assert.doesNotMatch(outputs.join('')+summary,/9999|PRIVATE_TOKEN|SECRET/);
});
