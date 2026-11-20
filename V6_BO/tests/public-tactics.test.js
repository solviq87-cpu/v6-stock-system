const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=import('../public/nova/data/tactics.js');
test('演示快照、表字段与共振排序可重现',async()=>{
  const {demoQuotes,demoMarket,evaluateUniverse,tactics,factors}=await engine;
  assert.equal(tactics.length,36);
  assert.equal(Object.keys(factors(demoQuotes[0],demoMarket)).length,25);
  assert.deepEqual(Object.keys(tactics[0]),['id','name','family','source','hitRule','failRule','cap','learn']);
  const quotes=Array.from({length:8},(_,i)=>({...demoQuotes[0],code:String(i)}));
  const run=()=>evaluateUniverse(quotes,demoMarket);
  assert.deepEqual(run(),run());
  assert.deepEqual(run().filter(s=>s.results.t36.hit).map(s=>s.quote.code),['0','1','2','3','4']);
});
test('环境优先级、仓位与观测命中',async()=>{
  const {demoQuotes,demoMarket,evaluateUniverse,marketPhase}=await engine;
  const scenarios=[
    ['冰点',{limits:24}],['退潮',{leaderDrop:true,brokenPct:26}],
    ['回暖',{previousPhase:'冰点'}],['主升',{}],['高潮',{height:5,limits:55}]
  ];
  for(const [phase,overrides] of scenarios){
    const market={...demoMarket,...overrides};
    assert.equal(marketPhase(market),phase);
    const [{results}]=evaluateUniverse(demoQuotes,market);
    if(['冰点','退潮'].includes(phase)){
      assert.ok(Object.values(results).every(r=>r.cap==='空仓'));
      assert.equal(results.t01.hit,false);
      assert.equal(results.t09.hit,phase==='冰点');
    }
    if(phase==='高潮'){
      const [s]=evaluateUniverse([{...demoQuotes[0],boards:4}],market);
      assert.ok(Object.values(s.results).every(r=>r.cap!=='半仓'));
    }
  }
});
test('超过15分钟时资金因子记中性',async()=>{
  const {demoQuotes,demoMarket,evaluateUniverse,factors}=await engine;
  const q={...demoQuotes[2],ageMinutes:16};
  const f=factors(q,demoMarket);
  for(const id of ['f05','f12','f20','f21','f22']) assert.equal(f[id],.5);
  const [{results}]=evaluateUniverse([q],demoMarket);
  for(const id of ['t27','t28','t29','t31','t32']) assert.equal(results[id].hit,false);
});
test('逐条校验36个命中场景及各自的失效边界',async()=>{
  const {demoQuotes:[base],demoMarket,evaluateTactic,tactics}=await engine;
  const fade={leaderDrop:true,brokenPct:26};
  // Each scenario starts from the same frozen quote. The second patch removes its signal.
  const cases=[
    [{},{opens:2}],
    [{},{priorLimits60:0}],
    [{boards:2,previous:base},{gap:6.1}],
    [{boards:2,priorLeaderFirst:true},{priorLeaderFirst:false}],
    [{priorWeak:true},{low:10.1}],
    [{priorUnderwater:true,priorLate:true},{gap:-1}],
    [{resealed:true},{close:9}],
    [{recentTurnSecond:true,volumeRatio:.8,close:9.8},{close:9}],
    [{},{otherLimitNext:false},{limits:24}],
    [{},{},fade,{leaderDrop:false}],
    [{boards:4},{boards:3},{height:5,limits:55}],
    [{boards:0},{heldVwap:false}],
    [{boards:2,priorLeaderFirst:true},{sealFalling:true}],
    [{role:'龙二',frontLimit:false},{sealDuration:9}],
    [{priorAcceleration:true,opens:1,resealed:true,volumeRatio:4},{opens:0}],
    [{pullDays:2,priorBear:true,open:10},{pullLow:9}],
    [{firstBear:true,priorBear:true,priorTurn:16,open:10},{priorHigh:12}],
    [{opens:1,resealed:true},{opens:2}],
    [{},{volumeRatio:1.2}],
    [{},{previousMa5:10}],
    [{low:10.1,volumeRatio:1.2},{close:9.9}],
    [{},{nextInside:true}],
    [{gapAge:3},{gapMin:10}],
    [{},{priorBandwidthRank:.21}],
    [{boards:0,change:2},{nextLostMa5:true},{indexChange:-1}],
    [{boards:0},{boards:1}],
    [{boards:0},{north:-1}],
    [{},{superOrder:-5}],
    [{},{sellerInstitution:true}],
    [{},{volumeRatio:1}],
    [{},{bigShare:null}],
    [{},{sectorRank:9}],
    [{close:9},{close:9.4}],
    [{heldDays:6,newHigh:false},{heldDays:5}],
    [{gap:7},{gap:6}],
    [{},{signalFirstLow:12}]
  ];
  assert.equal(cases.length,tactics.length);
  for(const [index,[yes,no,market,marketChange]] of cases.entries()){
    const {id}=tactics[index];
    const check=(quote,context)=>evaluateTactic(id,{...base,...quote},{...demoMarket,...context},[]).hit;
    assert.equal(check(yes,market),true,id+' 命中');
    assert.equal(check({...yes,...no},{...market,...marketChange}),false,id+' 失效');
  }
});
