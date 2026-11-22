'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crc32}=require('node:zlib');
const mod=name=>import('../public/nova/shortline/'+name+'.mjs');
const day='2026-11-18', end='2026-11-20', receipt=Date.parse(end+'T16:24:23+08:00');
const base=()=>({bars:[],checks:[],market:[],trades:[],candidates:[],notes:[],catalog:[],scope:'live'});
const inputK=(body,more={})=>({kind:'kline',csv:'收盘价,成交量(手),日期,代码,开盘价,最高价,最低价,成交额(万元)\r\n'+body,priceBasis:'unadjusted',volumeUnit:'lots',amountUnit:'wan',...more});
const row='10.5,456.78,20261118,000001,10,11,9,12.3';
const pool='证券代码\t名称\t所属题材\t原分类\t连板数\t首次封板时间\r\n000001\t原始标的\t材料与设备\tBK1234\t2\t093501';
const stamp=(fn)=>{const clock=Date.now;Date.now=()=>receipt;try{return fn();}finally{Date.now=clock;}};

test('vendor wizard decodes regular Chinese files, maps reordered columns and reports physical row numbers',async()=>{
 const {guessMapping,readVendorTable,decodeVendorCsv,previewVendorImport}=await mod('import-wizard');
 assert.equal(decodeVendorCsv(Uint8Array.from([0xc8,0xd5,0xc6,0xda])), '日期');
 assert.equal(decodeVendorCsv(Buffer.concat([Buffer.from([255,254]),Buffer.from('日期','utf16le')])),'日期');
 assert.equal(guessMapping(readVendorTable(pool).headers,'pool').theme,2);
 const ok=previewVendorImport(inputK(row),receipt);assert.deepEqual(ok.errors,[]);assert.equal(ok.rows[0].record.volume,45678);assert.equal(ok.rows[0].record.amount,123000);assert.equal(ok.rows[0].record.code,'000001');
 const bad=previewVendorImport(inputK(row+'\n\n10,1,2026-11-18,000002,10,9,8,1\nfoo,1,2026-11-18,000003,10,10,9,2'),receipt);
 assert.deepEqual(bad.errors.map(e=>e.line),[4,5]);
 assert.throws(()=>readVendorTable('a,b\n"unfinished'),/引号/);
 assert.throws(()=>previewVendorImport(inputK(row,{priceBasis:'forward'}),receipt),/不复权/);
 assert.throws(()=>previewVendorImport(inputK(row,{volumeUnit:''}),receipt),/单位/);
});
test('a conflicting batch is atomic, repeated data retains first receipt, and imported historical K cannot backdate a signal',async()=>{
 const {importAction}=await mod('import-wizard'),{deriveCheckInput,signals}=await mod('backtest');
 const state=base();
 stamp(()=>{
  const r=importAction(state,'import:ths',inputK(row,{knownAt:1}));assert.equal(r.count,1);
  assert.equal(state.bars[0].knownAt,receipt);assert.equal(state.bars[0].availableAt,end+' 16:24');
  assert.equal(state.bars[0].source,'同花顺客户端人工导出');assert.equal(state.bars[0].sampleSet,'real');
  assert.equal(importAction(state,'import:ths',inputK(row)).duplicates,1);assert.equal(state.importBatches.length,1);
  const before=JSON.stringify(state);
  const withConflict=row.replace('000001','000002')+'\n'+row.replace('10.5','10.8');
  assert.throws(()=>importAction(state,'import:ths',inputK(withConflict)),/第 3 行/);
  assert.throws(()=>importAction(state,'import:ths',inputK(row+'\ninvalid')),/第 3 行/);
  assert.equal(JSON.stringify(state),before);
  const ancient=deriveCheckInput(state,{code:'000001',date:day});assert.equal(ancient.selected.length,0);
  assert.equal(ancient.stockEvidence.close,undefined);assert.ok(ancient.recognition.missing.includes('当日可见的完整日 K'));
  const contemporaneous={...state,bars:state.bars.map(b=>({...b,knownAt:Date.parse(day+'T15:00:00+08:00'),availableAt:day+' 15:00'}))};
  assert.equal(deriveCheckInput(contemporaneous,{code:'000001',date:day}).stockEvidence.close,10.5);
  assert.equal(signals(state,day).length,0);
 });
});
test('limit sheets retain supplier native theme, per-session coverage and map exact provider IDs only',async()=>{
 const {importAction,guessMapping,readVendorTable}=await mod('import-wizard');
 const state=base();const p={kind:'pool',csv:pool,tradeDate:day,mapping:{...guessMapping(readVendorTable(pool).headers,'pool'),boardCode:3}};
 stamp(()=>{
  importAction(state,'import:ths',p);assert.equal(importAction(state,'import:ths',p).duplicates,1);
  const [b]=state.importedLimitPools;
  assert.equal(b.complete,false);assert.equal(b.tradeDate,day);assert.equal(b.knownAt,receipt);
  assert.equal(b.provider,'ths-desktop');assert.equal(b.rows[0].theme,'材料与设备');assert.equal(b.rows[0].boardCode,'BK1234');assert.equal(b.rows[0].firstSeal,'09:35:01');
  const before=JSON.stringify(state);assert.throws(()=>importAction(state,'import:ths',{...p,csv:pool.replace('材料与设备','后来解释')}),/不同记录/);assert.equal(JSON.stringify(state),before);
 });
});

test('flat journal separates self-reported amounts from the identified index and excludes future or mixed-source endpoints',async()=>{
 const {journalAction,flatBenchmark,flatLines}=await mod('journal-data');
 const make=(date,open,close,source,knownAt)=>({role:'index',period:'日K',code:'000985',date,source,knownAt,open,close,priceBasis:'unadjusted'});
 const state=base(),record=stamp(()=>journalAction(state,'journal:flat',{start:day,end,template:'指数破位回避',reason:'收盘后记录指数破位',benchmark:'000985',reportedPnl:'3.21'}));
 const first=make(day,100,105,'来源甲',receipt-10000),last=make(end,100,90,'来源乙',receipt-1);
 state.bars=[first,last];assert.match(flatBenchmark(state,record,receipt).reason,/同源/);
 state.bars.push({...last,source:'来源甲',knownAt:receipt+1000});assert.match(flatBenchmark(state,record,receipt).reason,/同源/);
 state.bars.push({...last,source:'来源甲'});
 const comparison=flatBenchmark(state,record,receipt);
 assert.equal(comparison.observed,2);assert.ok(Math.abs(comparison.returnPct+10)<1e-10);assert.ok(Math.abs(comparison.sampledDrawdownPct-100*(1-90/105))<1e-10);
 const lines=flatLines(state,record,receipt).join(' ');assert.match(lines,/人工自报.*3.21 元/);assert.match(lines,/反事实|情景结果/);
 assert.throws(()=>stamp(()=>journalAction(state,'journal:flat',{...record})),/重复/);
 const withTrade={...state,flatRecords:[],trades:[{date:day,exitTime:end+'T10:00'}]};
 assert.throws(()=>stamp(()=>journalAction(withTrade,'journal:flat',{...record})),/持仓/);
});

test('journal searches actual approval, correction and trade events; daily ZIP opens with correct UTF-8 files and escaped CSV cells',async()=>{
 const {journalRows,dailyExport,spreadsheetCsv}=await mod('journal');const {buildReview}=await mod('review');
 const state=base();
 state.trades=[{id:'a',date:day,entryTime:day+'T09:45',exitTime:end+'T10:00',exitReason:'计划兑现',code:'000001',strategy:'规则甲',factors:['因子丙'],planId:'冻结计划甲',name:'=1+1',pnl:-2,pnlAmount:-100,source:'原始交易档案',sampleSet:'real',quality:'标准样本'},
  {id:'test',date:day,exitTime:end+'T11:00',code:'000002',name:'教学隔离',quality:'黑天鹅',pnl:4,sampleSet:'test'}];
 state.corrections=[{recordedAt:end+' 11:02',date:day,mode:'撤销信号',id:'k/1',reason:'原形态有误'}];
 state.candidates=[{id:'提案甲',createdAt:day+'T02:00:00Z',decision:{at:end+'T02:00:00Z',reviewer:'李老师',reason:'按五关复核'},status:'已晋级'}];
 assert.equal(journalRows(state,{kind:'trade',end,code:'000001',factor:'因子丙',ref:'冻结计划甲',strategy:'规则甲'}).length,2);
 assert.equal(journalRows(state,{kind:'trade',end,code:'000001',ref:'不相关的样本'}).length,0);
 assert.equal(journalRows(state,{kind:'approval',start:end,end,query:'李老师'}).length,1);
 assert.equal(journalRows(state,{kind:'backtest',end,query:'原形态有误'}).length,1);
 assert.equal(journalRows(state,{kind:'trade',start:end,end,set:'test',quality:'blackSwan'}).length,1);
 const r=buildReview(state,{date:end,quality:'standard',set:'research'});assert.equal(r.totals.trades,1);assert.doesNotMatch(r.text,/教学隔离/);
 assert.match(spreadsheetCsv([['\t=NOW()',-3,'受"引号"保护']]),/'\t=NOW\(\)/);
 const zip=stamp(()=>dailyExport(state,end,{quality:'standard',set:'research'}));const bytes=Buffer.from(zip);
 const endRecord=bytes.length-22;
 assert.equal(bytes.readUInt32LE(endRecord),0x06054b50);
 const count=bytes.readUInt16LE(endRecord+10),contents={};
 let head=bytes.readUInt32LE(endRecord+16);
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(head),0x02014b50);
  assert.equal(bytes.readUInt16LE(head+8)&0x0800,0x0800);
  const local=bytes.readUInt32LE(head+42),size=bytes.readUInt32LE(head+24),nameBytes=bytes.readUInt16LE(head+28);
  const name=bytes.subarray(head+46,head+46+nameBytes).toString('utf8');
  assert.equal(bytes.readUInt32LE(local),0x04034b50);
  assert.equal(bytes.readUInt16LE(local+8),0,'standard STORE method');
  const offset=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),data=bytes.subarray(offset,offset+size);
  assert.equal(crc32(data),bytes.readUInt32LE(head+16));contents[name]=data.toString('utf8').replace(/^\uFEFF/,'');
  head+=46+nameBytes+bytes.readUInt16LE(head+30)+bytes.readUInt16LE(head+32);
 }
 assert.equal(head,endRecord);
  assert.deepEqual(Object.keys(contents),['当日复盘.md','交易记录.csv','回测结果.csv','日志.csv']);
  assert.match(contents['交易记录.csv'],/"'=1\+1"/);assert.match(contents['交易记录.csv'],/原始交易档案/);assert.match(contents['交易记录.csv'],/"-2"/);assert.doesNotMatch(contents['交易记录.csv'],/教学隔离/);
  assert.match(contents['回测结果.csv'],/原始数据取得时间/);assert.match(contents['当日复盘.md'],/样本集 正式研究/);
});
