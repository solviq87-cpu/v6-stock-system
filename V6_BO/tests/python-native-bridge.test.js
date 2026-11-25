'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {executePythonNative}=require('../src/core/python-native-bridge');
const dates=Array.from({length:32},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i/10,high:11+i/10,low:9+i/10,close:10+i/10,volume:1000}))}]};
function withScript(source,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-python-native-'));const script=path.join(dir,'trusted.py');fs.writeFileSync(script,source);try{return fn(script);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const header='import json,sys\nx=json.load(sys.stdin)\n';
test('trusted Python bridge runs one prefix-only observation per date with real three-round evidence',()=>withScript(header+`print(json.dumps({'symbol':x['symbol'],'date':x['date'],'observedThrough':x['date'],'evaluatorVersion':'python-native/v1','provenance':'python-runtime:trusted-local-script','rounds':[{'round':i,'verdict':'unknown','observedThrough':x['date'],'reason':'not enough original rule inputs'} for i in (1,2,3)]}))\n`,script=>{
 const r=executePythonNative(history,{script});assert.equal(r.execution.calls,32);assert.equal(Object.keys(r.evidence).length,32);assert.equal(r.evidence['000001/'+dates[0]].rounds[0].verdict,'unknown');
}));
test('bridge rejects fabricated future observation from Python',()=>withScript(header+`print(json.dumps({'symbol':x['symbol'],'date':x['date'],'observedThrough':'2099-01-01','evaluatorVersion':'python-native/v1','provenance':'python-runtime:trusted-local-script','rounds':[]}))\n`,script=>assert.throws(()=>executePythonNative(history,{script}),/日期/)));
test('bridge rejects Python output that is not JSON',()=>withScript('print("not json")\n',script=>assert.throws(()=>executePythonNative(history,{script}),/不是JSON/)));
test('bridge rejects Python runtime failure',()=>withScript('import sys\nsys.exit(3)\n',script=>assert.throws(()=>executePythonNative(history,{script}),/退出异常/)));
test('bridge requires explicit absolute trusted script',()=>assert.throws(()=>executePythonNative(history,{script:'untrusted.py'}),/绝对路径/));
test('bounded target-date execution preserves the full prefix and rejects invalid dates, budgets or code identity',()=>withScript(header+`assert len(x['bars'])==32\nprint(json.dumps({'symbol':x['symbol'],'date':x['date'],'observedThrough':x['date'],'evaluatorVersion':'python-native/v1','provenance':'python-runtime:trusted-local-script','rounds':[{'round':i,'verdict':'unknown','observedThrough':x['date'],'reason':'explicit target with full history'} for i in (1,2,3)]}))\n`,script=>{
 const options={script,targetDates:[dates.at(-1)],totalTimeoutMs:2000};
 assert.equal(executePythonNative(history,options).execution.calls,1);
 for(const targetDates of [[],[dates[0],dates[0]],['2099-01-01']])assert.throws(()=>executePythonNative(history,{...options,targetDates}),/目标日期/);
 assert.throws(()=>executePythonNative(history,{...options,totalTimeoutMs:0}),/总执行预算/);
 assert.throws(()=>executePythonNative(history,{...options,expectedScriptSha256:'0'.repeat(64)}),/版本已变化/);
}));
