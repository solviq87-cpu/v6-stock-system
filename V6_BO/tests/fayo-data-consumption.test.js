'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../public/nova/market-evidence.js')).toString('base64'));
test('scanner reasons remain visible and independent strategy reasons are preserved',async()=>{
 const {stockReasons}=await load();assert.deepEqual(stockReasons({reasons:['资金流入','量价异动']}),['资金流入','量价异动']);
 assert.deepEqual(stockReasons({hit:[{text:'规则一'}],reasons:['扫描解释']}),['规则一','扫描解释']);
 assert.deepEqual(stockReasons({hit:[],signals:['独立信号'],why:['另一条件'],reasons:['独立信号']}),['独立信号','另一条件']);
 assert.deepEqual(stockReasons({hit:[null,{text:'有效条件'}],explanation:['完整说明']}),['有效条件','完整说明']);
});
test('semantic pool failures cannot become successful empty pools; genuine empty results remain valid',async()=>{
 const {requirePoolReady}=await load();for(const payload of [{items:[],note:'行情未就绪'},{items:[],note:'计算失败：fixture'},{items:[],status:'unavailable'},{items:[],status:'computing'},{items:[],status:'error'},{items:[],status:'busy'},{ok:false,items:[],error:'源故障'}])assert.throws(()=>requirePoolReady(payload));
 for(const status of ['ready','empty']){const payload={status,items:[]};assert.equal(requirePoolReady(payload),payload);}
 assert.throws(()=>requirePoolReady({status:'unavailable',items:[],note:'原始采集故障'}),/原始采集故障/);
 const empty={items:[],note:'扫描完成，无命中'};assert.equal(requirePoolReady(empty),empty);
 const partial={items:[{code:'600001'}],note:'行情未就绪'};assert.throws(()=>requirePoolReady(partial));
 assert.throws(()=>requirePoolReady({status:' failed ',items:[]}));
});
test('the public feed includes bounded genuine cninfo announcements at source time, without mixing signal strategies',async()=>{
 const {newsRows}=await load(),announcement={title:'真实公告',source:'巨潮资讯 · 未独立核验',publishedAt:'2026-11-13T07:00:00.000Z',codes:['600001'],url:'https://static.cninfo.com.cn/finalpage/2026-11-13/123.pdf'};
 const state={goodNews:{items:[{title:'旧新闻',publishedAt:Date.parse('2026-11-12T07:00:00Z')}]},badNews:{items:[]},dashboard:{riskEvidence:{news:[announcement,announcement,{...announcement,title:'未知时点',publishedAt:''},{...announcement,title:'非公告',source:'未知'}]}},signals:[{code:'600001',type:'a'},{code:'600001',type:'b'}]};
 const rows=newsRows(state,'all');assert.equal(rows.length,2);assert.equal(rows[0].title,'真实公告');assert.equal(rows[0].publishedAt,announcement.publishedAt);assert.equal(rows[0].source,announcement.source);assert.equal(newsRows(state,'alerts').length,0);assert.deepEqual(newsRows(state,'signals'),state.signals);
 const strategies={...state,goodNews:{items:[{...announcement,strategyId:'a'},{...announcement,strategyId:'b'}]}};assert.equal(newsRows(strategies,'all').length,3,'existing distinct strategy events are not collapsed into announcement deduplication');
 assert.deepEqual(state.dashboard.riskEvidence.news[0],announcement);
});

test('cninfo additions require a complete original time and safe source URL, including at future boundaries',async()=>{
 const {newsRows}=await load(),now=Date.parse('2026-11-20T07:00:00Z');
 const row={title:'明确来源公告',source:'巨潮资讯 · 未独立核验',publishedAt:'2026-11-20T15:00:00+08:00',codes:['600001'],url:'https://static.cninfo.com.cn/finalpage/2026-11-20/123.pdf'};
 const project=records=>newsRows({dashboard:{riskEvidence:{news:records}}},'all',{now});
 assert.equal(project([row,row]).length,1);
 for(const publishedAt of ['2026-11-20','2026-11-20T15:00:00','2026-11-20T07:00:00.001Z','2026-02-31T07:00:00Z','2026-11-20T24:00:00Z',''])assert.equal(project([{...row,publishedAt}]).length,0,publishedAt);
 for(const url of ['http://static.cninfo.com.cn/finalpage/2026-11-20/123.pdf','https://evil.example/finalpage/2026-11-20/123.pdf','https://static.cninfo.com.cn.evil.example/finalpage/2026-11-20/123.pdf','javascript:alert(1)'])assert.equal(project([{...row,url}]).length,0,url);
 assert.equal(project([{...row,source:'来源未知'},{...row,codes:[]}]).length,0);
});
