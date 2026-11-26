'use strict';

// Source-only identity for persisted diagnostics. It never executes a dependency,
// walks require.cache, follows links, or reads an account/credential directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const SEEDS=Object.freeze([
 'src/core/evolution-diagnostic-version.js',
 'src/core/intelligence-evolution.js',
 'src/core/evolution-research-statistics.js',
 'src/core/research-causal-diagnostics.js',
 'src/core/native-strategy-daily-runner.js',
 'src/core/python-three-round-evidence.js',
 'src/core/research-workspace-analytics.js',
 'src/core/research-workspace-decision.js',
 'src/research/automatic-research.js',
 'src/strategy/research-v2-position-ledger-backtest.js',
 'src/strategy/historical-indicators.js',
 'src/core/common-entry-risk.js',
 'src/core/portfolio-risk-gate.js',
 'src/core/execution-risk.js',
 'src/core/trading-fees.js',
 'src/core/corporate-actions.js',
 'src/core/corporate-settlements.js',
 'src/core/historical-universe.js',
 'analysis.js','myrules.js','bazi.js',
 'strategies/a-share-strategy-pack.json',
 'strategies/extended-factor-pack.json',
 'package.json','package-lock.json'
].sort());
const MAX_FILES=512,MAX_FILE=8*1024*1024,MAX_TOTAL=64*1024*1024;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const local=name=>name.startsWith('./')||name.startsWith('../');
function permitted(relative){
 if(relative.split('/').some(p=>['data','node_modules','tests','.git','secrets'].includes(p)))return false;
 if(SEEDS.includes(relative))return true;
 if(/\.(?:js|cjs|mjs)$/.test(relative))return /^(?:src|scripts|public\/nova)\//.test(relative)||!relative.includes('/');
 return /\.json$/.test(relative)&&/^(?:strategies|config|public\/nova)\//.test(relative)&&!/(?:\.local\.|secret|credential|access-token)/i.test(relative);
}
function sourceDependencies(code){
 const names=new Set();
 // Literal local imports are resolved without Node module execution. Keeping
 // conservative matches in comments can invalidate a cache, never validate one.
 const patterns=[/\brequire(?:\.resolve)?\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g,/\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g,/\b(?:import|export)\s+(?:[^;\r\n]*?\s+from\s*)?(['"])([^'"\r\n]+)\1/g];
 for(const pattern of patterns)for(const match of code.matchAll(pattern))if(local(match[2]))names.add(match[2]);
 return [...names].sort();
}
// File metadata is a read-stability guard, not part of the portable content
// fingerprint. Nanosecond change times and inode identity catch replacements
// even when the byte count or mtime has been deliberately preserved.
const statOptions={bigint:true};
const directoryIdentity=stat=>[stat.dev,stat.ino,stat.mode].join(':');
const fileIdentity=stat=>[stat.dev,stat.ino,stat.mode,stat.nlink,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
function diagnosticImplementationManifest({root=ROOT}={}){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('诊断实现需要明确源码根目录');
 const base=path.resolve(root),rootStat=fs.lstatSync(base,statOptions);
 if(fs.realpathSync(base)!==base||!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('诊断源码根目录禁止链接');
 const rootIdentity=directoryIdentity(rootStat);
 let total=0;const files=new Map(),snapshots=new Map(),edges=[],pending=[...SEEDS];
 function relative(filename){const rel=path.relative(base,filename).split(path.sep).join('/');if(!rel||rel==='..'||rel.startsWith('../')||path.isAbsolute(rel)||!permitted(rel))throw Error('诊断依赖越出允许的源码范围');return rel;}
 function assertRoot(){
  const stat=fs.lstatSync(base,statOptions);
  if(!stat.isDirectory()||stat.isSymbolicLink()||directoryIdentity(stat)!==rootIdentity||fs.realpathSync(base)!==base)throw Error('诊断源码根目录已变化');
 }
 function inspect(filename){
  const rel=relative(filename),parts=rel.split('/'),parents=[];let at=base,stat;
  assertRoot();
  for(const [index,part] of parts.entries()){
   at=path.join(at,part);stat=fs.lstatSync(at,statOptions);
   if(stat.isSymbolicLink())throw Error('诊断源码依赖禁止符号链接');
   if(index<parts.length-1){if(!stat.isDirectory())return null;parents.push(directoryIdentity(stat));}
  }
  if(!stat.isFile())return null;
  if(stat.size<0n||stat.size>BigInt(MAX_FILE))throw Error('诊断源码依赖超过容量边界');
  return {rel,stat,identity:fileIdentity(stat),parents:parents.join('/')};
 }
 function assertUnchanged(filename,expected){
  const current=inspect(filename);
  if(!current||current.identity!==expected.identity||current.parents!==expected.parents)throw Error('诊断源码在读取期间变化');
 }
 function resolve(from,name){
  const filename=path.resolve(base,path.dirname(from),name);
  // Reject an out-of-tree or private path before any filesystem access.
  const candidates=path.extname(filename)?[filename]:[filename+'.js',filename+'.cjs',filename+'.mjs',filename+'.json',path.join(filename,'index.js'),path.join(filename,'index.mjs')];
  for(const candidate of candidates){
   try{const found=inspect(candidate);if(found)return found.rel;}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
  }
  throw Error('诊断源码依赖缺失：'+from+' → '+name);
 }
 while(pending.length){
  const rel=pending.shift();if(files.has(rel))continue;
  if(files.size>=MAX_FILES)throw Error('诊断源码依赖数量超过边界');
  const filename=path.join(base,rel),info=inspect(filename);if(!info)throw Error('诊断实现依赖不是普通文件');
  const size=Number(info.stat.size);
  if(total+size>MAX_TOTAL)throw Error('诊断源码读取容量无效');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));let bytes;
  try{
   const before=fs.fstatSync(fd,statOptions);
   if(!before.isFile()||fileIdentity(before)!==info.identity)throw Error('诊断源码打开时已变化');
   // Read only the inspected size plus one byte, never an unbounded growing
   // file or replaced FIFO. A short read or added byte invalidates the result.
   const buffer=Buffer.alloc(size+1);let offset=0;
   while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(n===0)break;offset+=n;}
   const after=fs.fstatSync(fd,statOptions);
   if(offset!==size||!after.isFile()||fileIdentity(after)!==info.identity)throw Error('诊断源码在读取期间变化');
   assertUnchanged(filename,info);bytes=buffer.subarray(0,size);total+=size;
  }finally{fs.closeSync(fd);}
  snapshots.set(rel,info);
  // Bind the adapter receipt/cutoff semantics by bytes, retaining the original
  // calculation graph and exclusion of unrelated archive/UI readers.
  const dependencies=/\.(?:js|cjs|mjs)$/.test(rel)&&rel!=='src/core/intelligence-evolution.js'?sourceDependencies(bytes.toString('utf8')).map(name=>{
   const target=resolve(rel,name);edges.push({from:rel,name,target});return target;
  }):[];
  files.set(rel,{path:rel,bytes:bytes.length,sha256:sha(bytes),dependencies:dependencies.sort()});pending.push(...dependencies);
 }
 // The closure must still resolve the same paths, including a newly created
 // higher-priority extension candidate. Recheck all source identities after
 // traversing the graph, not only the file most recently read.
 for(const edge of edges)if(resolve(edge.from,edge.name)!==edge.target)throw Error('诊断源码依赖解析已变化');
 for(const [rel,info] of snapshots)assertUnchanged(path.join(base,rel),info);
 assertRoot();
 const manifest={schemaVersion:2,protocol:'evolution-diagnostic-implementation-v2',runtime:{node:process.versions.node},files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
 return {...manifest,fingerprint:sha(JSON.stringify(manifest))};
}
function unavailable(){const error=Error('诊断实现版本不可核验，不能复用或保存旧诊断');error.code='DIAGNOSTIC_IMPLEMENTATION_UNAVAILABLE';return error;}

function diagnosticImplementationFingerprint(options){
 try{return diagnosticImplementationManifest(options).fingerprint;}
 catch{throw unavailable();}
}
function assertDiagnosticImplementationFingerprint(expected,options){
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||diagnosticImplementationFingerprint(options)!==expected)throw unavailable();
 return expected;
}
module.exports={diagnosticImplementationFingerprint,diagnosticImplementationManifest,assertDiagnosticImplementationFingerprint,SEEDS};
