'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const catalog=require('../config/six-photo-sources.json');
const {buildBank,selectBackup}=require('../src/core/six-photo-backups');
const script=path.resolve(__dirname,'../scripts/six-photo-sources.py');
const now=Date.parse('2026-11-06T16:00:00+08:00');
function runWorker(id,{legacy=false,both=false,failure=null,missingTime=false}={}){
 const failureLiteral=failure===null?'None':JSON.stringify(failure);
 const code=`import runpy,sys,types,json,importlib.metadata,socket
n=runpy.run_path(${JSON.stringify(script)})
calls=[]
def no_network(*a,**kw):raise AssertionError('network-forbidden')
socket.socket=no_network
importlib.metadata.version=lambda name: '1.20.35' if ${legacy?'True':'False'} else '1.20.70'
class Frame:
 def __init__(self,rows):self.rows=rows;self.columns=list(rows[0])
 def __len__(self):return len(self.rows)
 def sort_values(self,key,kind):return Frame(sorted(self.rows,key=lambda row:row[key]))
 def tail(self,size):return Frame(self.rows[-size:])
 def to_json(self,**kw):return json.dumps(self.rows,ensure_ascii=False)
def endpoint(name):
 def request(**kw):
  calls.append({'name':name,'kwargs':kw})
  if ${failureLiteral}=='request-error':raise RuntimeError('upstream-failed')
  if ${failureLiteral}=='attribute-error':raise AttributeError('inside-current-request')
  minute='min' in name
  key='day' if 'sina' in name or name=='stock_zh_a_minute' else '时间' if minute else '日期'
  row={'open':10,'close':11,'high':12,'low':9,'volume':100}
  if not ${missingTime?'True':'False'}:row[key]='2026-11-06 14:55:00' if minute else '2026-11-05'
  return Frame([row])
 return request
sdk=types.ModuleType('akshare')
names=['stock_zh_a_hist','stock_zh_a_minute'] if ${legacy?'True':'False'} else ['stock_zh_a_hist_em','stock_zh_a_hist_min_sina']
if ${both?'True':'False'}:names+=['stock_zh_a_hist','stock_zh_a_minute']
names+=['stock_zh_a_hist_min_em']
for name in names:setattr(sdk,name,endpoint(name))
if ${failureLiteral}=='non-callable':sdk.stock_zh_a_hist_em=None
sys.modules['akshare']=sdk
try:
 result=n['worker'](${JSON.stringify(id)},'600519','2026-11-02','2026-11-06','161725')
 print(json.dumps({'result':result,'calls':calls},ensure_ascii=False))
except Exception as error:print(json.dumps({'errorType':type(error).__name__,'error':str(error),'calls':calls}))
`;
 // Python receives source directly as one argv value; no shell and no SDK/network dependency.
 const r=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-c',code],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
function reportFor(id,result){
 return {schemaVersion:1,mode:'six-photo-source-backups',scope:catalog.scope,code:'600519',start:'2026-11-02',end:'2026-11-06',generatedAt:now,canTrade:false,verifiedLive:false,paidServicesUsed:false,
  sources:catalog.entries.map(e=>({...e,status:'unavailable',observedAt:now,instrument:{kind:e.kind==='fund-nav'?'fund':'stock',code:e.kind==='fund-nav'?'161725':'600519'},...(e.id===id?result:{})}))};
}
test('current AKShare names win over legacy aliases and keep exact original request/return contract',()=>{
 for(const [id,name,timeField,frequency] of [['akshare.daily','stock_zh_a_hist_em','日期','1d'],['akshare.minute.sina','stock_zh_a_hist_min_sina','day','5min']]){
  const {result,calls}=runWorker(id,{both:true});assert.equal(calls.length,1);assert.equal(calls[0].name,name);
  assert.equal(result.interfaceUsed,name);assert.equal(result.legacyInterfaceUsed,false);assert.equal(result.sdkVersion,'1.20.70');
  assert.equal(calls[0].kwargs.adjust,'');assert.equal(calls[0].kwargs.symbol,id==='akshare.daily'?'600519':'sh600519');
  assert.equal(calls[0].kwargs.period,id==='akshare.daily'?'daily':'5');
  if(id==='akshare.daily')assert.deepEqual([calls[0].kwargs.start_date,calls[0].kwargs.end_date],['20261102','20261106']);
  const c=result.dataContract;assert.equal(c.frequencyRequested,frequency);assert.equal(c.adjustmentRequested,'none');assert.equal(c.sourceTimeField,timeField);
  for(const key of ['adjustmentVerified','volumeUnit','amountUnit','delayed','delayMs','sourceTimeVerified','originalQuoteAt'])assert.equal(c[key],null,key);
  assert.equal(c.canTrade,false);assert.equal(result.data.records[0].volume,100);
  const bank=buildBank(reportFor(id,result),now),entry=bank.sources.find(s=>s.id===id);
  assert.equal(entry.status,'research-backup');assert.equal(entry.interfaceUsed,name);assert.deepEqual(entry.dataContract,c);
  assert.equal(entry.unitStatus,'provider-native-unverified');assert.equal(selectBackup(bank,{kind:'quote',code:'600519'}),null);
 }
});
test('pinned older AKShare entry points remain compatible and record actual interface used',()=>{
 for(const [id,name] of [['akshare.daily','stock_zh_a_hist'],['akshare.minute.sina','stock_zh_a_minute']]){
  const {result,calls}=runWorker(id,{legacy:true});assert.equal(calls.length,1);assert.equal(calls[0].name,name);
  assert.equal(result.interfaceUsed,name);assert.equal(result.legacyInterfaceUsed,true);assert.equal(result.sdkVersion,'1.20.35');
  const entry=buildBank(reportFor(id,result),now).sources.find(s=>s.id===id);
  assert.equal(entry.status,'research-backup');assert.equal(entry.interfaceUsed,name);assert.equal(entry.canTrade,false);
 }
});
test('request failure including internal AttributeError never triggers legacy retries or alternate sources',()=>{
 for(const failure of ['request-error','attribute-error']){
  const r=runWorker('akshare.daily',{both:true,failure});assert.equal(r.calls.length,1);assert.equal(r.calls[0].name,'stock_zh_a_hist_em');
  assert.equal(r.errorType,failure==='request-error'?'RuntimeError':'AttributeError');assert.equal(r.result,undefined);
 }
 const invalid=runWorker('akshare.daily',{both:true,failure:'non-callable'});assert.equal(invalid.errorType,'AttributeError');assert.equal(invalid.calls.length,0);
});
test('unchanged Eastmoney minute API retains five-minute unadjusted request and original range',()=>{
 const {result,calls}=runWorker('akshare.minute.em');assert.equal(calls[0].name,'stock_zh_a_hist_min_em');
 assert.deepEqual(calls[0].kwargs,{symbol:'600519',start_date:'2026-11-02 09:30:00',end_date:'2026-11-06 15:00:00',period:'5',adjust:''});
 assert.equal(result.dataContract.sourceTimeField,'时间');assert.equal(result.dataContract.upstream,'eastmoney');
});
test('absent source time stays absent and cannot become a valid bar or execution quote',()=>{
 const {result}=runWorker('akshare.minute.sina',{missingTime:true});assert.equal(result.dataContract.sourceTimeField,null);
 assert.equal(result.dataContract.originalQuoteAt,null);assert.equal(result.data.records[0].day,undefined);
 const bank=buildBank(reportFor('akshare.minute.sina',result),now);assert.equal(bank.availableCount,0);assert.equal(bank.sources.find(s=>s.id==='akshare.minute.sina').status,'data-invalid');
});
test('historical report names remain readable without retroactively claiming an actual SDK version or call',()=>{
 const {result}=runWorker('akshare.daily');delete result.interfaceUsed;delete result.sdkVersion;delete result.dataContract;
 const report=reportFor('akshare.daily',result),source=report.sources.find(s=>s.id==='akshare.daily');source.interface='stock_zh_a_hist';
 const original=JSON.stringify(report),entry=buildBank(report,now).sources.find(s=>s.id==='akshare.daily');
 assert.equal(entry.status,'research-backup');assert.equal(entry.reportedInterface,'stock_zh_a_hist');assert.equal(entry.interface,'stock_zh_a_hist_em');
 assert.equal(entry.interfaceUsed,null);assert.equal(entry.sdkVersion,null);assert.equal(entry.dataContract,null);assert.equal(JSON.stringify(report),original);
});
test('forged interface or verified data-contract claims are rejected and arbitrary fields are not projected',()=>{
 const {result}=runWorker('akshare.daily');
 const report=reportFor('akshare.daily',result);report.sources.find(s=>s.id==='akshare.daily').interfaceUsed='other-provider';assert.throws(()=>buildBank(report,now),/source/);
 for(const key of ['canTrade','sourceTimeVerified','adjustmentVerified','delayed']){
  const copy=JSON.parse(JSON.stringify(result));copy.dataContract[key]=true;
  assert.equal(buildBank(reportFor('akshare.daily',copy),now).sources.find(s=>s.id==='akshare.daily').status,'data-invalid');
 }
 result.dataContract.secret='PRIVATE_SENTINEL';const view=buildBank(reportFor('akshare.daily',result),now);assert.ok(!JSON.stringify(view).includes('PRIVATE_SENTINEL'));
});
