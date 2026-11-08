'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {catalog,matchedIds,projectStrategyStocks}=require('../src/strategy/dashboard-strategy-catalog');
test('strategy catalogue has unique ids across active and research groups',()=>{
 assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);
 for(const prefix of ['base:','playbook:','pattern:','research:','planned:'])assert.ok(catalog.some(x=>x.id.startsWith(prefix)));
});
test('per-strategy stocks only contain actually matched evidence',()=>{
 const a={symbol:'000001',name:'测试票',score:70,quality:{usable:true,fresh:false},strategy:{strategies:[{name:'trend',pass:true}],playbookAnalysis:{playbooks:[{id:'platform_breakout',status:'candidate'}]}},patterns:{checks:[{id:'red_three_soldiers',status:'matched'},{id:'three_black_crows',status:'not_matched'}]}};
 const b={symbol:'000002',strategy:{strategies:[{name:'trend',pass:false}]}};
 assert.deepEqual(matchedIds(a),['base:trend','playbook:platform_breakout','pattern:red_three_soldiers']);
 assert.equal(projectStrategyStocks({items:[a,b]},'base:trend').length,1);
 assert.equal(projectStrategyStocks({items:[a,b]},'pattern:three_black_crows').length,0);
 assert.equal(projectStrategyStocks({items:[a,b]},'planned:vnpy_boll_cci').length,0);
 assert.equal(projectStrategyStocks({items:[a,b]},'base:trend')[0].dataStatus,'unverified-or-stale');
});
