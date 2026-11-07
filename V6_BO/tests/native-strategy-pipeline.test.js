'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runResearch}=require('../scripts/native-strategy-daily');
const dates=Array.from({length:32},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:20,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i/10,high:11+i/10,low:9+i/10,close:10+i/10,volume:1000}))}]};
function withScript(source,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-pipeline-'));const script=path.join(dir,'trusted.py');fs.writeFileSync(script,source);try{return fn(script);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const py=`import json,sys\nx=json.load(sys.stdin)\nprint(json.dumps({'symbol':x['symbol'],'date':x['date'],'observedThrough':x['date'],'evaluatorVersion':'python-native/v1','provenance':'python-runtime:trusted-local-script','rounds':[{'round':i,'verdict':'unknown','observedThrough':x['date'],'reason':'原策略输入不足'} for i in (1,2,3)]}))\n`;
test('unified pipeline runs native daily research without Python and explicitly marks Python unconfigured',()=>{
 const r=runResearch(history);assert.equal(r.mode,'native-daily-research');assert.equal(r.pythonExecution.mode,'not-configured');assert.equal(r.coverage.python.unknown,32);
});
test('unified pipeline executes trusted Python per date and feeds evidence into strategy replay',()=>withScript(py,script=>{
 const r=runResearch(history,{pythonScript:script});assert.equal(r.pythonExecution.calls,32);assert.equal(r.coverage.python.unknown,32);assert.equal(r.details.length,32);assert.ok(r.pythonEvidenceFingerprint);
}));
test('unified pipeline rejects fabricated future dates from Python before producing a report',()=>withScript(py.replace("x['date'],'evaluatorVersion'","'2099-01-01','evaluatorVersion'"),script=>assert.throws(()=>runResearch(history,{pythonScript:script}),/日期/)));
