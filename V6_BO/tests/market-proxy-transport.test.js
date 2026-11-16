'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(require.resolve('../em'),'utf8');
function fn(name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,name);
 return source.slice(start,source.indexOf('\n}',start)+2);
}
function harness({env={},status=200,body=Buffer.from([0xc4,0xe3,0xba,0xc3]),failed=false}={}){
 const calls=[],events=[],dirs=[];
 const context=vm.createContext({fs,path,Buffer,Promise,process:{env},console,
  require:id=>{assert.equal(id,'os');return os;},EM_AGENT:{},
  marketRequests:{run:async(url,work)=>{events.push('reserved');return work();}},
  checkMarketResponse:(_url,code)=>{events.push('status:'+code);if([403,429].includes(code))throw Object.assign(Error('restricted'),{code:'MARKET_RESTRICTED',status:code});},
  execFile:(program,args,options,done)=>{
   events.push('curl');calls.push({program,args,options});
   const headers=args[args.indexOf('--dump-header')+1],file=args[args.indexOf('--output')+1];
   dirs.push(path.dirname(file));
   fs.writeFileSync(headers,'HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 '+status+'\r\nRetry-After: 60\r\n\r\n');
   fs.writeFileSync(file,body);
   done(failed?Error('raw transport details must not escape'):null,String(status));
  },
  https:{get:(_url,_options,respond)=>{
   events.push('native');const req=new EventEmitter();req.destroy=()=>{};
   queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers={};res.resume=()=>{};respond(res);res.emit('data',body);res.emit('end');});
   return req;
  }}
 });
 vm.runInContext(['usesMarketProxy','nodeGetBytes','curlGet'].map(fn).join('\n')+'\nthis.read=nodeGetBytes;this.json=curlGet;',context);
 return {read:context.read,json:context.json,calls,events,dirs};
}
test('standard HTTPS and ALL proxy settings use one bounded byte transport without leaking proxy values to argv',async()=>{
 for(const key of ['https_proxy','HTTPS_PROXY','all_proxy','ALL_PROXY']){
  const proxy='http://fixture-user:fixture-password@private-proxy.invalid:8080',h=harness({env:{[key]:proxy,NO_PROXY:'localhost,127.0.0.1'}});
  const body=await h.read('https://qt.gtimg.cn/q=sh000001',4000,{'Referer':'https://gu.qq.com'});
  assert.deepEqual(body,Buffer.from([0xc4,0xe3,0xba,0xc3]),'non-JSON market bytes survive unchanged');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].program,'curl');
  const {args,options}=h.calls[0];
  assert.equal(args[0],'--disable');assert.equal(args[args.indexOf('--max-redirs')+1],'0');
  assert.equal(args.includes('--location'),false);assert.equal(args.includes('--insecure'),false);
  assert.equal(args.some(x=>x.includes(proxy)),false);assert.equal(options.env,undefined,'curl consumes the unchanged proxy and NO_PROXY environment');
  assert.ok(args.includes('Referer: https://gu.qq.com'));assert.equal(options.timeout,5000);
  assert.deepEqual(h.events,['reserved','curl','status:200']);assert.ok(h.dirs.every(dir=>!fs.existsSync(dir)));
 }
});
test('unproxied environments keep the native transport',async()=>{
 const h=harness();await h.read('https://qt.gtimg.cn/q=sh000001');
 assert.equal(h.calls.length,0);assert.deepEqual(h.events,['reserved','native','status:200']);
});
test('proxy restrictions stop immediately without native fallback and temporary bytes are removed',async()=>{
 for(const status of [403,429]){
  const h=harness({env:{HTTPS_PROXY:'http://proxy.invalid'},status});
  await assert.rejects(h.read('https://qt.gtimg.cn/q=sh000001'),e=>e.code==='MARKET_RESTRICTED'&&e.status===status);
  assert.deepEqual(h.events,['reserved','curl','status:'+status]);assert.equal(h.calls.length,1);assert.ok(h.dirs.every(dir=>!fs.existsSync(dir)));
 }
});
test('redirects, transfer failures and oversized responses remain failures instead of empty successful quotes',async()=>{
 for(const input of [{status:302},{failed:true},{body:Buffer.alloc(8000001)}]){
  const h=harness({env:{HTTPS_PROXY:'http://proxy.invalid'},...input});
  await assert.rejects(h.read('https://qt.gtimg.cn/q=sh000001'),/market (?:HTTP 302|curl transport failed|response too large)/);
  assert.equal(h.calls.length,1);assert.ok(h.dirs.every(dir=>!fs.existsSync(dir)));
 }
});
test('existing JSON-only curl callers retain their parsed JSON contract',async()=>{
 const h=harness({body:Buffer.from('{"data":{"qdate":20261113}}')});
 const result=await h.json('https://push2ex.eastmoney.com/getTopicZTPool');
 assert.equal(result.data.qdate,20261113);assert.equal(Buffer.isBuffer(result),false);assert.ok(h.dirs.every(dir=>!fs.existsSync(dir)));
});
