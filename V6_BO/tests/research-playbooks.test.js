'use strict';
const assert=require('node:assert/strict');
const {evaluatePlaybooks}=require('../src/strategy/research-playbook-engine');
const pack=require('../strategies/research-playbooks.json');
let n=0;function ok(v){assert.ok(v);n++;}
ok(pack.playbooks.length===10);ok(pack.sources.length===6);
const none=evaluatePlaybooks({});
ok(none.matched===0);ok(none.playbooks.length===10);
ok(none.playbooks.find(x=>x.id==='first_to_second').status==='insufficient_data');
ok(none.playbooks.find(x=>x.id==='leader_sector').status==='insufficient_data');
const bars=Array.from({length:35},(_,i)=>({open:10+i*.1,high:10.3+i*.1,low:9.8+i*.1,close:10.1+i*.1,volume:1e6}));
const some=evaluatePlaybooks({bars,leaderStrengthScore:85,sectorHeatScore:80,resealScore:80,sealQualityScore:90,moneyPersistenceScore:80,fundFlowScore:80});
ok(some.playbooks.find(x=>x.id==='leader_sector').status==='candidate');
ok(some.playbooks.find(x=>x.id==='reseal_strength').status==='candidate');
ok(some.playbooks.find(x=>x.id==='money_flow_continuation').status==='candidate');
ok(some.playbooks.every(x=>x.autoTrade===false));
ok(evaluatePlaybooks({bars,leaderStrengthScore:'90',sectorHeatScore:90}).playbooks.find(x=>x.id==='leader_sector').status==='insufficient_data');
ok(pack.playbooks.every(p=>p.risk&&p.inputs.length));
console.log('PASS '+n+' research playbook assertions');
