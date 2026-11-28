'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),script=path.join(root,'V6_BO/scripts/validate-fayo-ledger.py'),book=path.join(root,'docs/fayo-professional/deliverables/checklist.xlsx');
const python=execFileSync(process.env.V6_MODEL_PYTHON||'python3',['-I','-S','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
const original=fs.readFileSync(book);
const mutation=String.raw`
import base64,io,json,sys,zipfile,warnings,xml.etree.ElementTree as E
warnings.filterwarnings('ignore',category=UserWarning)
p=json.load(sys.stdin);z=zipfile.ZipFile(io.BytesIO(base64.b64decode(p['data'])));parts={n:z.read(n) for n in z.namelist()};S='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}';R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
w=E.fromstring(parts['xl/workbook.xml']);rels=E.fromstring(parts['xl/_rels/workbook.xml.rels']);targets={r.get('Id'):'xl/'+r.get('Target').removeprefix('/xl/').removeprefix('./') for r in rels};sheets={n.get('name'):targets[n.get(R)] for n in w.findall(S+'sheets/'+S+'sheet')};extras=[]
for patch in p['patches']:
 if patch['op']=='entry':extras.append((patch['name'],patch['value'].encode()));continue
 if patch['op']=='external':
  node=E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'injectedExternal','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+patch['kind'],'Target':patch['value'],'TargetMode':'External'});parts['xl/_rels/workbook.xml.rels']=E.tostring(rels,encoding='utf-8');continue
 key=sheets[patch['sheet']];t=E.fromstring(parts[key])
 if patch['op']=='set':
  c=next(c for c in t.findall(S+'sheetData/'+S+'row/'+S+'c') if c.get('r')==patch['cell']);attrs=dict(c.attrib);c.clear();c.attrib.update(attrs);value=patch['value']
  if patch.get('formula'):
   E.SubElement(c,S+'f').text='1+1';E.SubElement(c,S+'v').text=str(value)
  elif isinstance(value,int):c.set('t','n');E.SubElement(c,S+'v').text=str(value)
  else:c.set('t','inlineStr');E.SubElement(E.SubElement(c,S+'is'),S+'t').text=value
 elif patch['op']=='filter':t.find(S+'autoFilter').set('ref',patch['value'])
 elif patch['op']=='dimension':t.find(S+'dimension').set('ref',patch['value'])
 elif patch['op']=='rawxml':parts[key]=patch['value'].encode();continue
 parts[key]=E.tostring(t,encoding='utf-8')
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as out:
 for k,v in parts.items():out.writestr(k,v)
 for k,v in extras:out.writestr(k,v)
sys.stdout.buffer.write(b.getvalue())
`;
function mutate(patches){return execFileSync(python,['-I','-S','-B','-c',mutation],{input:JSON.stringify({data:original.toString('base64'),patches}),maxBuffer:4*1024*1024});}
function invoke(file,args=[],options={}){const r=spawnSync(python,['-I','-S',script,'--workbook',file,...args],{encoding:'utf8',maxBuffer:2*1024*1024,...options});assert.equal(r.error,undefined);assert.equal(r.signal,null);return {status:r.status,report:JSON.parse(r.stdout),text:r.stdout};}
function modified(t,patches){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-ledger-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'ledger.xlsx');fs.writeFileSync(file,mutate(patches));return file;}
const codes=r=>r.report.errors.map(e=>e.code);
const set=(sheet,cell,value,other={})=>({op:'set',sheet,cell,value,...other});
let canonical;
const baseline=()=>canonical??=invoke(book).report;
test('canonical complete inventories validate offline with stdlib only and stay read-only',()=>{
 const r=invoke(book);assert.equal(r.status,0);assert.equal(r.report.structurePassed,true);assert.equal(r.report.counts.tasks,228);assert.equal(r.report.counts.modules,50);
 assert.deepEqual(r.report.counts.batches.map(b=>b.taskCount),[100,76,52]);assert.equal(r.report.counts.catalogRecords['原60项来源'],60);assert.equal(r.report.counts.catalogRecords['历史66与78项目录'],78);
 assert.equal(r.report.counts.efficiencyChapters,24);assert.ok(r.report.documentHyperlinksIgnored>0);assert.deepEqual(fs.readFileSync(book),original);
 assert.equal(r.report.releaseReady,false);assert.equal(r.report.businessAcceptanceVerified,false);assert.equal(r.report.managerSignoffVerified,false);assert.equal(r.report.historicalOriginalTextsVerified,false);
 assert.doesNotMatch(r.text,/https:\/\//);
});
test('the actual prior stale F12 module-total regression is rejected',t=>{
 const current=baseline().counts.byModule.F12.partial||0;
 const r=invoke(modified(t,[set('50模块','E13',current===0?1:0),set('50模块','F13',6)]));assert.equal(r.status,1);assert.ok(codes(r).includes('module-counts-do-not-match-task-rows'));
});
test('new batch columns and appended consumer rows cannot escape the Excel filter',t=>{
 for(const patch of [{op:'filter',sheet:'228项专业能力',value:'A1:L229'},{op:'filter',sheet:'最终集成功能映射',value:'A1:K19'}]){
  const r=invoke(modified(t,[patch]));assert.equal(r.status,1);assert.ok(codes(r).includes('filter-does-not-cover-populated-cells'));
 }
});
test('missing or duplicate IDs and unknown status values cannot be hidden by correct row counts',t=>{
 for(const value of ['F51.1','F01.2']){const r=invoke(modified(t,[set('228项专业能力','A2',value)]));assert.equal(r.status,1);assert.ok(codes(r).includes('task-ids-missing-duplicate-or-unknown'));}
 const r=invoke(modified(t,[set('228项专业能力','H2','已完成')]));assert.equal(r.status,1);assert.ok(codes(r).includes('task-status-unknown'));
});
test('individual batch placement, overview totals and scope sizes are derived from actual task rows',t=>{
 const totals=baseline().counts.statuses,phase=baseline().counts.batches[0].statuses;
 for(const [patch,code] of [
  [set('228项专业能力','M2','第二批：收益研究与组合风控'),'task-delivery-batch-mismatch'],
  [set('总览','C2',`完整签收 ${totals.declaredComplete||0}，局部证据 ${(totals.partial||0)+1}，待逐项验收 ${(totals.awaiting||0)-1}`),'summary-counts-do-not-match-task-rows'],
  [set('总览','C28',`局部证据 ${(phase.partial||0)+1}，待逐项验收 ${(phase.awaiting||0)-1}，完整签收 ${phase.declaredComplete||0}`),'summary-counts-do-not-match-task-rows'],
  [set('总览','B2','50模块 / 227项'),'professional-scope-size-mismatch']]){
  const r=invoke(modified(t,[patch]));assert.equal(r.status,1);assert.ok(codes(r).includes(code),JSON.stringify(r.report.errors));
 }
});
test('shared catalog IDs, consumer references, headers and all24 efficiency chapters remain checked',t=>{
 for(const [patch,code] of [
  [set('6份合同','A2','G99'),'catalog-ids-missing-duplicate-or-unknown'],
  [set('最终集成功能映射','A2','F99.1'),'consumer-task-reference-unknown'],
  [set('最终集成功能映射','A2','F12.1.2'),'consumer-task-reference-unknown'],
  [set('228项专业能力','M1',''),'required-column-missing'],
  [set('跨专项执行约束','A2','01'),'efficiency-chapters-missing-or-unknown']]){
  const r=invoke(modified(t,[patch]));assert.equal(r.status,1);assert.ok(codes(r).includes(code),JSON.stringify(r.report.errors));
 }
});
test('formula caches and false worksheet dimensions cannot act as ledger evidence',t=>{
 for(const patch of [set('228项专业能力','H2','局部证据',{formula:true}),{op:'dimension',sheet:'228项专业能力',value:'A1:L229'}]){
  const r=invoke(modified(t,[patch]));assert.equal(r.status,1);assert.ok(codes(r).includes(patch.formula?'ledger-formula-not-evaluated':'dimension-does-not-match-populated-cells'));
 }
});
test('ordinary evidence hyperlinks are never followed and external data, macros and duplicate ZIP parts fail closed',t=>{
 const canary='DO_NOT_EXPOSE_WORKBOOK_PAYLOAD';
 for(const patch of [
  {op:'external',kind:'externalLink',value:'https://example.invalid/'+canary},
  {op:'entry',name:'xl/vbaProject.bin',value:canary},
  {op:'entry',name:'xl/workbook.xml',value:canary},
  {op:'rawxml',sheet:'228项专业能力',value:'<!DOCTYPE a [<!ENTITY leak "'+canary+'">]><a>&leak;</a>'}]){
  const r=invoke(modified(t,[patch]));assert.equal(r.status,1);assert.equal(r.report.structurePassed,false);assert.doesNotMatch(r.text,new RegExp(canary));
 }
});
test('even a structurally consistent declared complete record is not manager acceptance or release permission',t=>{
 const b=baseline(),previous=b.taskStatuses['F01.1'];
 const update=counts=>{const next={partial:0,awaiting:0,declaredComplete:0,...counts};next[previous]--;next.declaredComplete++;return next;};
 const module=update(b.counts.byModule.F01),totals=update(b.counts.statuses),phase=update(b.counts.batches[0].statuses);
 const file=modified(t,[set('228项专业能力','H2','完整签收'),set('50模块','D2',module.declaredComplete),set('50模块','E2',module.partial),set('50模块','F2',module.awaiting),set('总览','C2',`完整签收 ${totals.declaredComplete}，局部证据 ${totals.partial}，待逐项验收 ${totals.awaiting}`),set('总览','C28',`局部证据 ${phase.partial}，待逐项验收 ${phase.awaiting}，完整签收 ${phase.declaredComplete}`)]);
 const r=invoke(file,['--strict']);assert.equal(r.status,2);assert.equal(r.report.structurePassed,true);assert.ok(r.report.counts.statuses.declaredComplete>=1);
 assert.equal(r.report.managerSignoffVerified,false);assert.equal(r.report.businessAcceptanceVerified,false);assert.equal(r.report.releaseReady,false);
});
test('exact version pin binds both workbook and validator plus reused XML guard; writes or stale SHAs are rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-ledger-git-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const scripts=path.join(dir,'V6_BO/scripts'),books=path.join(dir,'docs/fayo-professional/deliverables');fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(books,{recursive:true});fs.mkdirSync(path.join(dir,'empty-hooks'));
 for(const name of ['validate-fayo-ledger.py','stock-workbook.py'])fs.copyFileSync(path.join(root,'V6_BO/scripts',name),path.join(scripts,name));const file=path.join(books,'checklist.xlsx');fs.writeFileSync(file,original);
 const git=(...args)=>execFileSync('git',['-C',dir,'-c','core.hooksPath='+path.join(dir,'empty-hooks'),'-c','commit.gpgsign=false','-c','user.name=FayoFixture','-c','user.email=fixture@fayo.invalid',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init');git('add','V6_BO','docs');git('commit','-m','isolated ledger fixture');const sha=git('rev-parse','HEAD');
 const run=(expected=sha)=>{const r=spawnSync(python,['-I','-S',path.join(scripts,'validate-fayo-ledger.py'),'--repo',dir,'--workbook',file,'--expect-sha',expected],{encoding:'utf8'});return {status:r.status,report:JSON.parse(r.stdout)};};
 let r=run();assert.equal(r.status,0);assert.equal(r.report.versionBound,true);assert.equal(r.report.repositoryHead,sha);assert.ok(!fs.existsSync(path.join(scripts,'__pycache__')));
 r=run('0'.repeat(40));assert.equal(r.status,1);assert.ok(codes(r).includes('expected-commit-or-workbook-mismatch'));
 fs.appendFileSync(path.join(scripts,'validate-fayo-ledger.py'),'\n# uncommitted validator revision\n');r=run();assert.equal(r.status,1);assert.equal(r.report.validatorMatchesRepositoryCommit,false);
 fs.copyFileSync(script,path.join(scripts,'validate-fayo-ledger.py'));fs.appendFileSync(path.join(scripts,'stock-workbook.py'),'\n# uncommitted XML guard\n');r=run();assert.equal(r.status,1);assert.equal(r.report.xmlGuardMatchesRepositoryCommit,false);
 fs.copyFileSync(path.join(root,'V6_BO/scripts/stock-workbook.py'),path.join(scripts,'stock-workbook.py'));fs.writeFileSync(file,mutate([set('228项专业能力','F2','changed target consumer')]));r=run();assert.equal(r.status,1);assert.equal(r.report.workbookMatchesRepositoryCommit,false);
});
test('a structure-only standalone check can run without Git; pinned acceptance cannot silently fall back',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-ledger-no-git-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const env={...process.env,PATH:dir};let r=invoke(book,[],{env});assert.equal(r.status,0);assert.equal(r.report.repositoryHead,null);assert.equal(r.report.versionBound,false);
 r=invoke(book,['--expect-sha','0'.repeat(40)],{env});assert.equal(r.status,1);assert.ok(codes(r).includes('expected-commit-or-workbook-mismatch'));
});
