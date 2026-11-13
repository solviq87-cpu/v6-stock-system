'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {reviewPushedOutcomes: review} = require('../src/core/pushed-outcome-review');
const {classifyFeishuReceipt: receipt} = require('../src/core/feishu-receipt');
const at = Date.parse('2026-11-12T10:00:00+08:00');
const close = Date.parse('2026-11-12T16:00:00+08:00');
const entry = (extra = {}) => ({ts:at,status:'✅ 已送达(私密)',title:'趋势样本',codes:['600000'],...extra});
const history = () => ({src:'fixture',receivedAt:close,rows:[{date:'20261112',close:10,pct:0}]});
const runReview = (log, h = history()) => review({date:'20261112',now:close,pushlog:[log],histories:{'600000':h}});

test('real production pushLog records are consumable without moving codes into extra', () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('function pushLog(');
  const body = source.slice(start, source.indexOf('\n}\n',start)+2);
  class Clock extends Date { constructor(...args){super(...(args.length?args:[at]));} static now(){return at;} }
  const c = vm.createContext({Date:Clock,PUSH_LOG:[],pushTitle:()=> '趋势样本',dataCapOf:()=>100,
    _pushLogTimer:null,pushLogFlush(){},sseSendEdit(){},console,setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(body,c);
  c.pushLog('✅ 已送达(私密)','fixture',{codes:['600000'],channel:'飞书·私密'});
  const log = JSON.parse(JSON.stringify(c.PUSH_LOG[0]));
  assert.equal(log.extra,undefined);
  assert.equal(runReview(log).samples[0].code,'600000');
});

test('root codes are authoritative and old nested/string formats remain compatible', () => {
  assert.equal(runReview(entry({extra:{codes:['600001']}})).samples.length,1);
  for(const extra of [{codes:['600000']},"{'codes': ['600000']}"])
    assert.equal(runReview({ts:at,status:'gateway-accepted',title:'legacy',extra}).samples.length,1);
  for(const codes of [null,[],['bad']])
    assert.throws(()=>runReview(entry({codes,extra:{codes:['600000']}})),/没有可核对/);
});

test('explicit unfinished bars cannot become closing outcomes at a later receive time', () => {
  const h=history();h.rows[0].final=false;
  assert.throws(()=>runReview(entry({extra:{codes:['600000']}}),h),/没有完整/);
});

test('contradictory acceptance and rejection codes remain unknown to preserve deduplication', () => {
  for(const payload of [{code:0,StatusCode:19021},{code:11232,StatusCode:0}]){
    const r=receipt(200,payload);assert.equal(r.ok,false);assert.equal(r.status,'unknown');assert.match(r.msg,/送达结果未知/);
  }
  assert.equal(receipt(200,{code:11232}).status,'rejected');
});

test('CLI isolates bad stock caches and refuses corrupted stored results without overwriting', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-review-followup-'));
  try {
    const cache=path.join(root,'.kline_cache');fs.mkdirSync(cache);
    fs.writeFileSync(path.join(root,'pushlog.json'),JSON.stringify([entry({codes:['600000','600001'],extra:{codes:['600000','600001']}})]));
    fs.writeFileSync(path.join(cache,'600000.json'),JSON.stringify(history()));
    fs.writeFileSync(path.join(cache,'600001.json'),'{broken');
    fs.writeFileSync(path.join(cache,'600002.json'),'{unrelated');
    fs.writeFileSync(path.join(root,'learn_pushed_outcomes.json'),'untouched legacy');
    const run=()=>spawnSync(process.execPath,[path.join(__dirname,'../_learn_pushed_outcomes.js'),'20261112'],{
      encoding:'utf8',env:{PATH:process.env.PATH,V6_PUSH_OUTCOME_ROOT:root}});
    let r=run();assert.equal(r.status,0,r.stderr);
    const output=path.join(root,'learn_pushed_outcomes_review.json');
    const doc=JSON.parse(fs.readFileSync(output));assert.equal(doc.samples.length,1);
    assert.deepEqual(doc.cacheReadErrors,{missing:0,invalid:1});
    assert.equal(run().status,0);
    doc.samples[0].pct='corrupt';doc.samples[0].code='600999';
    const damaged=JSON.stringify(doc);fs.writeFileSync(output,damaged);
    r=run();assert.equal(r.status,1);assert.match(r.stderr,/既有复盘/);
    assert.equal(fs.readFileSync(output,'utf8'),damaged);
    fs.writeFileSync(output,'null');assert.equal(run().status,1);
    assert.equal(fs.readFileSync(output,'utf8'),'null');
    assert.equal(fs.readFileSync(path.join(root,'learn_pushed_outcomes.json'),'utf8'),'untouched legacy');
    assert.equal(fs.existsSync(output+'.lock'),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
