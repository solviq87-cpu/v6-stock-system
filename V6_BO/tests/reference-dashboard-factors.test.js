'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {evaluateFactor}=require('../public/assets/v6-factor-evidence.js');
const base=path.join(__dirname,'..'),pack=require('../public/assets/v6-extended-factors.json');
const html=fs.readFileSync(path.join(base,'public/reference-dashboard.html'),'utf8');
const js=fs.readFileSync(path.join(base,'public/assets/v6-reference-dashboard.js'),'utf8');
test('all 15 registry factors have the same names, fields and weights as V6 engine',()=>{
 const canonical=require('../strategies/extended-factor-pack.json');
 assert.deepEqual(pack.factors,canonical.factors);assert.equal(pack.factors.length,15);
 assert.match(html,/id="factor-catalog-dialog"/);assert.match(js,/v6:stock-selected/);
});
test('no fake or cross-stock factor evidence, missing and simulated never scored',()=>{
 const f=pack.factors[0],now=Date.parse('2026-11-08T15:00:00Z');
 assert.equal(evaluateFactor({code:'600519',[f.field]:97},f,now).score,null);
 assert.equal(evaluateFactor({code:'600519',[f.field]:97,simulated:true,factorEvidence:{[f.field]:{source:'fixture',timestamp:now}}},f,now).score,null);
 assert.equal(evaluateFactor({code:'600519',[f.field]:97,factorEvidence:{[f.field]:{source:'eastmoney',timestamp:now,code:'300750'}}},f,now).score,null);
 assert.equal(evaluateFactor({code:'600519',[f.field]:0,factorEvidence:{[f.field]:{source:'market',timestamp:now}}},f,now).score,0);
});
test('only recent evidence is fresh; historical is clearly separated',()=>{
 const f=pack.factors[0],now=Date.parse('2026-11-08T15:00:00Z');
 const stock={code:'600519',[f.field]:78,factorEvidence:{[f.field]:{source:'verified-provider',timestamp:now-1000}}};
 assert.equal(evaluateFactor(stock,f,now).state,'verified');
 stock.factorEvidence[f.field].timestamp=now-60*60*1000;
 const old=evaluateFactor(stock,f,now);assert.equal(old.state,'historical');assert.equal(old.score,78);
 stock.factorEvidence[f.field].timestamp=now+1000*120;
 assert.equal(evaluateFactor(stock,f,now).state,'unverified');
});
test('market rendering does not present mock or missing quotes as live values',()=>{
 assert.match(js,/d\?\.isMock !== true/);assert.match(js,/d\?\.simulated !== true/);
 assert.match(js,/data set|dataset\.quoteState = quote \? 'observed'/i);
 assert.match(js,/item\.price\)>0/);
});