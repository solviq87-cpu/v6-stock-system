'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {featuresAt}=require('../src/strategy/model-features');
const {modelExperiment}=require('../src/strategy/model-experiment');
const {chinaValue}=require('../src/strategy/china-value');
const {scanUniverse}=require('../src/strategy/universe-scanner');

function fixture(){
 const dates=[];for(let i=0;dates.length<102;i++){
  const date=new Date(Date.UTC(2025,0,1+i));
  if(date.getUTCDay()%6!==0)dates.push(date.toISOString().slice(0,10));
 }
 return {splitDay:88,source:'simulated',stocks:Array.from({length:10},(_,j)=>({
  symbol:String(600000+j),market:'main',bars:dates.map((date,i)=>{
   const open=10+j+i*.01+.2*Math.sin(i/(3+j)),close=open+.05*Math.cos(i+j);
   return {date,open,close,low:Math.min(open,close)-.01,high:Math.max(open,close)+.01,volume:10000+i*5+j,
    marketCap:1e8*(j+1),financials:{ttmProfit:5e6,publishedAt:'2024-12-01T09:00:00+08:00'}};
  })}))};
}
test('模型特征仅取历史窗口并通过扫描入口暴露',()=>{
 const s=fixture().stocks[0],before=featuresAt(s.bars,67);s.bars[68].close*=2;
 assert.deepEqual(featuresAt(s.bars,67),before);assert.equal(featuresAt(s.bars,59),null);
 const now=Date.now(),rows=scanUniverse({now,stocks:[{...s,bars:s.bars.slice(0,68),feed:{source:'simulated',timestamp:now}}]});
 assert.deepEqual(rows.items[0].researchFeatures,before);
});
test('价值筛选过滤小市值、未披露和缺报财务',()=>{
 const date='2025-01-02';
 const rows=Array.from({length:10},(_,i)=>({symbol:String(i),marketCap:i+1,financials:{ttmProfit:1,publishedAt:date+'T14:59:59+08:00'}}));
 rows[4].financials.publishedAt=date+'T15:00:01+08:00';delete rows[5].financials;
 const selected=chinaValue(rows,date);
 assert.deepEqual([...selected.keys()],['3','6','7','8','9']);assert.equal(selected.get('3'),.25);
 rows[0].marketCap=null;assert.equal(chinaValue(rows,date).size,0);
});
test('真实 CLI 加载三类估计器并使用同一留出账本',()=>{
 const config=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-model-'));
 try{
  const file=path.join(dir,'input.json');fs.writeFileSync(file,JSON.stringify(config));
  const child=spawnSync(process.execPath,[path.resolve(__dirname,'../tools/research-runner.js'),'models',file],{encoding:'utf8',timeout:45000});
  assert.equal(child.status,0,child.stderr);const r=JSON.parse(child.stdout);
  assert.equal(r.trainingRows,260);assert.ok(r.lastTrainingLabelDate<r.firstEvaluationDate);
  assert.equal(r.latest.length,10);assert.equal(r.autoTrade,false);
  for(const key of ['ridge','extraTrees','histBoost','momentum','lowVol','chinaValue','v6Original'])
   assert.ok(Number.isFinite(r.summaries[key].returnPct));
  for(const key of ['ridge','extraTrees','histBoost'])assert.ok(Number.isFinite(r.latest[0].scores[key]));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('延长样本外数据不改变已产生的预测',()=>{
 const cfg=fixture(),end=94;
 const short=modelExperiment({...cfg,end});
 // A future price shock lies beyond the requested end.
 cfg.stocks[0].bars[end+1].high*=1.5;
 const before=cfg.stocks.map(s=>({...s,bars:s.bars.slice(0,end+1)}));
 const isolated=modelExperiment({...cfg,stocks:before});
 assert.deepEqual(short.latest,isolated.latest);assert.deepEqual(short.summaries,isolated.summaries);
 assert.throws(()=>modelExperiment({...cfg,splitDay:2}),/区间/);
 cfg.stocks[1].bars[2].date=cfg.stocks[1].bars[1].date;
 assert.throws(()=>modelExperiment(cfg),/对齐|日历/);
});

test('留出首日价格不会进入训练标签；风险否决不参与排序',()=>{
 const cfg=fixture(),original=modelExperiment(cfg);
 const bar=cfg.stocks[0].bars[cfg.splitDay];
 bar.open*=1.5;bar.high=Math.max(bar.open,bar.high);
 cfg.stocks[9].bars.at(-1).isST=true;
 const changed=modelExperiment(cfg);
 assert.equal(changed.latest.some(r=>r.symbol===cfg.stocks[9].symbol),false);
 for(const name of ['ridge','extraTrees','histBoost']){
  assert.equal(original.latest[1].scores[name],changed.latest[1].scores[name]);
 }
});
