'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

const python=process.env.V6_MODEL_PYTHON||'python3';
const runner=path.resolve(__dirname,'../tools/fit-market-models.py');
const defaults=['ridge','extraTrees','histBoost'];
function fixture(){
 const x=Array.from({length:64},(_,i)=>[i/64,Math.sin(i/5),i%3]);
 return {x,y:x.map(row=>row[0]*.3-.1+row[1]*.01),test:[[.1,0,1],[.5,1,2],[.9,-1,0]]};
}
function run(input,blocked=[]){
 const args=blocked.length?['-c',[
  'import builtins, runpy, sys',
  'original_import = builtins.__import__',
  `blocked = ${JSON.stringify(blocked)}`,
  'def guarded(name, *args, **kwargs):',
  '    if name.split(".")[0] in blocked: raise ModuleNotFoundError("blocked optional dependency " + name)',
  '    return original_import(name, *args, **kwargs)',
  'builtins.__import__ = guarded',
  'runpy.run_path(sys.argv[1], run_name="__main__")'
 ].join('\n'),runner]:[runner];
 return spawnSync(python,args,{encoding:'utf8',input:JSON.stringify(input),timeout:30000,
  env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'}});
}
function result(child){
 assert.equal(child.status,0,child.error?.message||child.stderr);
 return JSON.parse(child.stdout);
}

test('Python 默认三模型不依赖可选库，显式模型选择保持原预测',()=>{
 const data=fixture(),baseline=result(run(data,['lightgbm','xgboost']));
 assert.deepEqual(Object.keys(baseline.scores),defaults);
 assert.deepEqual(result(run({...data,models:defaults})).scores,baseline.scores);
 const subset=result(run({...data,models:['histBoost','ridge']}));
 assert.deepEqual(Object.keys(subset.scores),['histBoost','ridge']);
 for(const name of ['histBoost','ridge']){
  assert.deepEqual(subset.scores[name],baseline.scores[name]);
  assert.equal(subset.modelVersions[name],baseline.version);
 }
});

test('Python 拒绝空、未知、重复或非数组模型配置',()=>{
 for(const models of [[],null,'ridge',['ridge','ridge'],['unknown'],[1],[{}]]){
  const child=run({...fixture(),models});
  assert.notEqual(child.status,0,JSON.stringify(models));
  assert.match(child.stderr,/models/);
  assert.equal(child.stdout,'');
 }
});

test('Python 拒绝不对齐、缺失或非有限数值训练输入',()=>{
 for(const patch of [{x:[]},{y:[1]},{test:[[1,2]]},{test:[[null,0,1]]},
  {test:[['1',0,1]]},{test:[[true,0,1]]},{x:[[1,2],[3]]}]){
  const child=run({...fixture(),...patch});
  assert.notEqual(child.status,0,JSON.stringify(patch));
  assert.match(child.stderr,/有限数值|列数一致/);
 }
});

for(const name of ['lightgbm','xgboost']){
 test(`Python 显式请求 ${name} 缺依赖时失败且不静默降级`,()=>{
  const child=run({...fixture(),models:['ridge',name]},[name]);
  assert.notEqual(child.status,0);
  assert.match(child.stderr,new RegExp(name+' 依赖不可用'));
  assert.match(child.stderr,/requirements-models-optional\.txt/);
  assert.equal(child.stdout,'');
 });
 test(`可选 ${name} 对含负收益标签的固定数据产生确定性回归输出`,t=>{
  const available=spawnSync(python,['-c',`import importlib.util; print(importlib.util.find_spec('${name}') is not None)`],{encoding:'utf8',timeout:10000});
  assert.equal(available.status,0,available.error?.message||available.stderr);
  if(available.stdout.trim()==='False')return t.skip(`${name} 未安装；安装 tools/requirements-models-optional.txt 后运行`);
  const data={...fixture(),models:['ridge',name]},first=result(run(data)),again=result(run(data));
  assert.deepEqual(Object.keys(first.scores),['ridge',name]);
  assert.deepEqual(first.scores,again.scores);
  assert.equal(typeof first.modelVersions[name],'string');
  assert.ok(first.modelVersions[name].length);
  for(const values of Object.values(first.scores)){
   assert.equal(values.length,data.test.length);assert.ok(values.every(Number.isFinite));
  }
  assert.deepEqual(first.scores.ridge,result(run({...data,models:['ridge']})).scores.ridge);
 });
}
