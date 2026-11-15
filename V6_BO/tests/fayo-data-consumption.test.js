'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../public/nova/market-evidence.js')).toString('base64'));
test('scanner reasons remain visible and independent strategy reasons are preserved',async()=>{
 const {stockReasons}=await load();assert.deepEqual(stockReasons({reasons:['资金流入','量价异动']}),['资金流入','量价异动']);
 assert.deepEqual(stockReasons({hit:[{text:'规则一'}],reasons:['扫描解释']}),['规则一','扫描解释']);
});
test('semantic pool failures cannot become successful empty pools; genuine empty results remain valid',async()=>{
 const {requirePoolReady}=await load();for(const payload of [{items:[],note:'行情未就绪'},{items:[],note:'计算失败：fixture'},{items:[],status:'unavailable'},{items:[],status:'computing'},{items:[],status:'error'},{items:[],status:'busy'},{ok:false,items:[],error:'源故障'}])assert.throws(()=>requirePoolReady(payload));
 for(const status of ['ready','empty']){const payload={status,items:[]};assert.equal(requirePoolReady(payload),payload);}
 assert.throws(()=>requirePoolReady({status:'unavailable',items:[],note:'原始采集故障'}),/原始采集故障/);
 const empty={items:[],note:'扫描完成，无命中'};assert.equal(requirePoolReady(empty),empty);
 const partial={items:[{code:'600001'}],note:'行情未就绪'};assert.throws(()=>requirePoolReady(partial));
});
test('the public feed includes bounded genuine cninfo announcements at source time, without mixing signal strategies',async()=>{
 const {newsRows}=await load(),announcement={title:'真实公告',source:'巨潮资讯 · 未独立核验',publishedAt:'2026-11-13T07:00:00.000Z',codes:['600001'],url:'https://static.cninfo.com.cn/finalpage/2026-11-13/123.pdf'};
 const state={goodNews:{items:[{title:'旧新闻',publishedAt:Date.parse('2026-11-12T07:00:00Z')}]},badNews:{items:[]},dashboard:{riskEvidence:{news:[announcement,announcement,{...announcement,title:'未知时点',publishedAt:''},{...announcement,title:'非公告',source:'未知'}]}},signals:[{code:'600001',type:'a'},{code:'600001',type:'b'}]};
 const rows=newsRows(state,'all');assert.equal(rows.length,2);assert.equal(rows[0].title,'真实公告');assert.equal(rows[0].publishedAt,announcement.publishedAt);assert.equal(rows[0].source,announcement.source);assert.equal(newsRows(state,'alerts').length,0);assert.deepEqual(newsRows(state,'signals'),state.signals);
 const strategies={...state,goodNews:{items:[{...announcement,strategyId:'a'},{...announcement,strategyId:'b'}]}};assert.equal(newsRows(strategies,'all').length,3,'existing distinct strategy events are not collapsed into announcement deduplication');
 assert.deepEqual(state.dashboard.riskEvidence.news[0],announcement);
});
