'use strict';
// Append-only content-addressed private records. The hash proves consistency,
// not provider authenticity, and missing historical evidence is never rebuilt.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {validateProductionSignalEvidence} = require('./signal-evidence-chain');
const MAX_FILE = 600 * 1024, MAX_RECORDS = 2000, MAX_BYTES = 16 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw Error('信号证据目录必须为私有绝对路径');
  const full = path.resolve(value);
  if (full === path.parse(full).root || full.split(path.sep).some(part => part.toLowerCase() === 'public')) throw Error('禁止公开信号证据目录');
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('信号证据路径禁止符号链接'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
function checkQuery(date,code,id) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date || !/^\d{6}$/.test(code || '') || (id !== undefined && !/^[a-f0-9]{64}$/.test(id))) throw Error('信号证据查询身份无效');
}
function readFile(file) {
  const fd = fs.openSync(safePath(file),fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let raw;try { const st=fs.fstatSync(fd);if(!st.isFile()||st.size>MAX_FILE)throw Error('信号证据文件类型或大小无效');raw=fs.readFileSync(fd,'utf8'); } finally {fs.closeSync(fd);}
  const event=JSON.parse(raw),{archiveHash,...payload}=event;
  if (archiveHash!==hash(payload)||!validateProductionSignalEvidence(event.evidence).ok) throw Error('信号证据归档完整性校验失败');
  return event;
}
function readEvidence(root,{date,code,id,limit=100}={}) {
  checkQuery(date,code,id);
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('信号证据查询上限无效');
  const privateRoot=safePath(root);
  if(fs.existsSync(privateRoot)){const st=fs.statSync(privateRoot);if(!st.isDirectory()||(st.mode&0o077)!==0)throw Error('信号证据根目录必须为0700');}
  const dir=safePath(path.join(privateRoot,date,code));
  if(id){const event=readFile(path.join(dir,id+'.json'));if(event.evidence.signalId!==id||event.evidence.code!==code||day(event.evidence.triggerAt)!==date)throw Error('信号证据身份不匹配');return {schemaVersion:1,canTrade:false,records:[event],total:1};}
  if(!fs.existsSync(dir))return {schemaVersion:1,canTrade:false,records:[],total:0};
  const names=fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
  if(names.length>MAX_RECORDS)throw Error('信号证据目录超过上限');
  const events=names.map(name=>{const event=readFile(path.join(dir,name));if(event.evidence.signalId+'.json'!==name||event.evidence.code!==code||day(event.evidence.triggerAt)!==date)throw Error('信号证据身份不匹配');return event;}).sort((a,b)=>b.evidence.triggerAt-a.evidence.triggerAt||a.evidence.signalId.localeCompare(b.evidence.signalId));
  return {schemaVersion:1,canTrade:false,records:events.slice(0,limit),total:events.length};
}
function appendEvidence(root,evidence,{clock=Date.now}={}) {
  const check=validateProductionSignalEvidence(evidence);if(!check.ok)throw Error(check.reason);
  const recordedAt=clock();if(!Number.isSafeInteger(recordedAt)||recordedAt<evidence.triggerAt)throw Error('信号证据记录时点无效');
  const privateRoot=safePath(root);fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});
  if((fs.statSync(privateRoot).mode&0o077)!==0)throw Error('信号证据根目录必须为0700');
  const date=day(evidence.triggerAt),dir=safePath(path.join(privateRoot,date,evidence.code));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,evidence.signalId+'.json');
  if(fs.existsSync(file)){const old=readFile(file);if(old.evidence.evidenceFingerprint!==evidence.evidenceFingerprint)throw Error('信号证据标识冲突');return {signalId:evidence.signalId,reused:true,status:'archived'};}
  const names=fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
  let bytes=0;for(const name of names)bytes+=fs.lstatSync(path.join(dir,name)).size;
  const payload={schemaVersion:1,recordedAt,evidence},event={...payload,archiveHash:hash(payload)},raw=JSON.stringify(event);
  if(names.length>=MAX_RECORDS||bytes+Buffer.byteLength(raw)>MAX_BYTES||Buffer.byteLength(raw)>MAX_FILE)throw Error('信号证据归档达到容量上限');
  const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;readFile(file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return {signalId:evidence.signalId,reused:false,status:'archived'};
}
module.exports={appendEvidence,readEvidence};
