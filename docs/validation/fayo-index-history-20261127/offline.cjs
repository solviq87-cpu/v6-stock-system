'use strict';
// Run through the original syscall-denial helper. Historical and fresh inputs remain synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createIndexWindowResearch}=require(path.resolve('src/core/index-window-research'));
const root=process.argv[2];let now=Date.parse('2026-11-27T10:00:00+08:00');
const files=fs.readdirSync(root).sort().map(d=>path.join(root,d,'000001.json'));
const hashes=()=>files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
const before=hashes(),radar=createIndexWindowResearch({historyRoot:root,clock:()=>now});assert.equal(radar.view(now).priorDaysObserved,20);
for(let m=0;m<6;m++){now=Date.parse('2026-11-27T10:00:00+08:00')+m*60000;radar.observe({day:'20261127',indices:[{code:'1.000001',price:m===5?110:100+m/10,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}]},{day:'20261127',trading:true},now);}
const v=radar.view(now);assert.deepEqual(v.events.map(e=>e.windowMinutes),[1,5]);assert.ok(v.events.every(e=>!e.canTrade&&!e.canNotify&&e.references.every(r=>/^[a-f0-9]{64}$/.test(r.archiveHash))));assert.deepEqual(hashes(),before);
console.log(JSON.stringify({scope:'kernel-denied network, restored synthetic original journals',restoredDays:20,events:2,allArchiveBytesUnchanged:true,canTrade:false,canNotify:false,sourceVerified:v.history.sourceVerified,canTrain:v.history.canTrain}));
