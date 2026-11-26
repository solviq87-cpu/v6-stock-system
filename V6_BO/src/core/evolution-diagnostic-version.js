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
function diagnosticImplementationManifest({root=ROOT}={}){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('诊断实现需要明确源码根目录');
 const base=path.resolve(root);
 if(fs.realpathSync(base)!==base||!fs.lstatSync(base).isDirectory())throw Error('诊断源码根目录禁止链接');
 let total=0;const files=new Map(),pending=[...SEEDS];
 function relative(filename){const rel=path.relative(base,filename).split(path.sep).join('/');if(!rel||rel==='..'||rel.startsWith('../')||path.isAbsolute(rel)||!permitted(rel))throw Error('诊断依赖越出允许的源码范围');return rel;}
 function inspect(filename){
  const rel=relative(filename);let at=base;
  for(const part of rel.split('/')){at=path.join(at,part);const stat=fs.lstatSync(at);if(stat.isSymbolicLink())throw Error('诊断源码依赖禁止符号链接');}
  const stat=fs.statSync(filename);if(!stat.isFile())return null;
  if(stat.size>MAX_FILE||total+stat.size>MAX_TOTAL)throw Error('诊断源码依赖超过容量边界');
  return {rel,stat};
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
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let bytes;
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX_FILE||total+stat.size>MAX_TOTAL)throw Error('诊断源码读取容量无效');bytes=fs.readFileSync(fd);total+=bytes.length;}finally{fs.closeSync(fd);}
  // Bind the adapter's receipt/cutoff semantics by bytes. Its unrelated archive
  // and UI readers are outside the calculation graph; calculation roots above
  // still receive the full recursive dependency walk.
  const dependencies=/\.(?:js|cjs|mjs)$/.test(rel)&&rel!=='src/core/intelligence-evolution.js'?sourceDependencies(bytes.toString('utf8')).map(name=>resolve(rel,name)):[];
  files.set(rel,{path:rel,bytes:bytes.length,sha256:sha(bytes),dependencies:dependencies.sort()});pending.push(...dependencies);
 }
 const manifest={schemaVersion:1,protocol:'evolution-diagnostic-implementation-v1',runtime:{node:process.versions.node},files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
 return {...manifest,fingerprint:sha(JSON.stringify(manifest))};
}
function diagnosticImplementationFingerprint(options){
 try{return diagnosticImplementationManifest(options).fingerprint;}
 catch{const error=Error('诊断实现版本不可核验，不能复用或保存旧诊断');error.code='DIAGNOSTIC_IMPLEMENTATION_UNAVAILABLE';throw error;}
}
module.exports={diagnosticImplementationFingerprint,diagnosticImplementationManifest,SEEDS};
