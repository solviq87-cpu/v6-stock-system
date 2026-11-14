'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {adaptCachedKline}=require('./research-v2-cached-kline-adapter');
const codeOk=c=>/^\d{6}$/.test(String(c));
const allowed=new Set(['imported','simulated','eastmoney-cache','akshare-cache','tonghuashun-cache']);
function safeRoot(root){const p=path.resolve(root);if(p===path.parse(p).root)throw Error('不允许磁盘根目录');return p;}
function store(root,{code,rows,name='',cachedAt=Date.now(),origin='imported'}={}){
 if(!codeOk(code)||!allowed.has(origin)||!Array.isArray(rows)||rows.length<27||rows.length>500)throw Error('缓存字段非法');
 const now=Date.now(),audit=adaptCachedKline(String(code),{rows,name},{cachedAt,now});
 if(audit.error)throw Error(audit.error);
 const dir=safeRoot(root);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('缓存目录不能是符号链接');
 const payload={schema:1,code:String(code),name:String(name).slice(0,50),rows,cachedAt,origin,verifiedLive:false};
 const raw=JSON.stringify(payload);if(Buffer.byteLength(raw)>400000)throw Error('缓存超过400KB');
 const hash=crypto.createHash('sha256').update(raw).digest('hex');
 const target=path.join(dir,code+'.json');const temp=path.join(dir,'.'+code+'.'+process.pid+'.'+crypto.randomBytes(6).toString('hex')+'.tmp');
 try{if(fs.lstatSync(target).isSymbolicLink())throw Error('拒绝覆盖符号链接缓存');}catch(e){if(e.code!=='ENOENT')throw e;}
 try{fs.writeFileSync(temp,JSON.stringify({hash,payload}),{mode:0o600,flag:'wx'});fs.renameSync(temp,target);}finally{try{fs.unlinkSync(temp);}catch{}}
 return {code:String(code),hash,cachedAt,origin};
}
function read(root,code,{now=Date.now()}={}){
 if(!codeOk(code))return {stock:null,error:'代码无效'};
 let raw;try{
  const file=path.join(safeRoot(root),String(code)+'.json');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>500000)return {stock:null,error:'磁盘缓存超限或类型非法'};
   raw=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
 }catch{return {stock:null,error:'磁盘缓存不存在或不安全'};}
 if(Buffer.byteLength(raw)>500000)return {stock:null,error:'磁盘缓存超限'};
 try{
  const {hash,payload}=JSON.parse(raw);if(payload.schema!==1||payload.code!==String(code)||!allowed.has(payload.origin))throw Error('结构不合法');
  if(crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==hash)throw Error('校验和不匹配');
  const result=adaptCachedKline(String(code),payload,{cachedAt:payload.cachedAt,now});
  if(result.stock){result.stock.dataAudit.origin='persisted-research-cache';result.stock.dataAudit.declaredSource=payload.origin;}
  return result;
 }catch(e){return {stock:null,error:'缓存损坏：'+e.message};}
}
function list(root,{limit=100}={}){
 const dir=safeRoot(root);let names=[];try{names=fs.readdirSync(dir);}catch{return [];}
 return names.filter(x=>/^\d{6}\.json$/.test(x)).sort().filter(x=>{try{return fs.lstatSync(path.join(dir,x)).isFile();}catch{return false;}}).slice(0,Math.min(100,Math.max(1,limit))).map(x=>x.slice(0,6));
}
module.exports={store,read,list};
