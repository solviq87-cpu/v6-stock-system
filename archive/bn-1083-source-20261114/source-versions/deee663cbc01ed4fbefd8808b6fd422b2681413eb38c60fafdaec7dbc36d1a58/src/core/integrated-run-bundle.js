'use strict';
/** Immutable, verifiable offline research runs. Never an order-routing interface. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {runUnifiedStrategyProject}=require('./unified-strategy-project');
const {executePythonNative}=require('./python-native-bridge');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
function safeDirectory(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('运行输出目录必须是绝对路径');
 const full=path.resolve(directory);
 let part=path.parse(full).root;
 for(const segment of full.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,segment);
  if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw Error('运行输出路径不允许符号链接');
 }
 return full;
}
function assertFile(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('输入文件必须使用绝对路径');
 const p=safeDirectory(file);
 if(!fs.statSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw Error('输入必须是普通文件');
 return p;
}
function readJson(file){return JSON.parse(fs.readFileSync(assertFile(file),'utf8'));}
function makeBundle({historyPath,snapshotsPath,evidencePath,pythonScript,outputRoot}={}){
 if(pythonScript&&evidencePath)throw Error('原生Python与导入证据不可混用');
 const root=safeDirectory(outputRoot);
 const history=readJson(historyPath);
 const snapshots=snapshotsPath?readJson(snapshotsPath):{};
 const supplied=evidencePath?readJson(evidencePath):{};
 const executed=pythonScript?executePythonNative(history,{script:assertFile(pythonScript)}):null;
 const evidence=executed?executed.evidence:supplied;
 const options={snapshots,pythonEvidence:evidence,pythonExecution:executed?.execution,splitDay:history.splitDay};
 // Compute and validate everything before creating the output directory.
 const report=runUnifiedStrategyProject(history,options);
 const files={'history.json':json(history),'snapshots.json':json(snapshots),'python-evidence.json':json(evidence),'report.json':json(report)};
 const inputs=Object.fromEntries(Object.entries(files).map(([name,content])=>[name,{sha256:sha(content),bytes:Buffer.byteLength(content)}]));
 const id=sha(json({schemaVersion:1,inputs,pythonScriptSha256:executed?.execution?.scriptSha256||null})).slice(0,24);
 const finalDir=path.join(root,id);
 if(fs.existsSync(finalDir))throw Error('运行结果已存在，禁止覆盖: '+id);
 fs.mkdirSync(root,{recursive:true});
 const staging=fs.mkdtempSync(path.join(root,'.run-'));
 const manifest={schemaVersion:1,runId:id,mode:'immutable-offline-research',canTrade:false,verifiedLive:false,pythonExecution:executed?.execution||null,files:inputs};
 try{
  for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(staging,name),content,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(staging,'manifest.json'),json(manifest),{flag:'wx',mode:0o600});
  for(const name of [...Object.keys(files),'manifest.json']){
   const fd=fs.openSync(path.join(staging,name),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  fs.renameSync(staging,finalDir);
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }catch(err){fs.rmSync(staging,{recursive:true,force:true});throw err;}
 return {runId:id,directory:finalDir,manifest,gate:report.gate};
}
function verifyBundle(directory,{replay=false}={}){
 const dir=safeDirectory(directory);
 if(!fs.statSync(dir).isDirectory())throw Error('运行目录无效');
 const manifest=readJson(path.join(dir,'manifest.json'));
 if(manifest.schemaVersion!==1||manifest.canTrade!==false||manifest.verifiedLive!==false||!/^[0-9a-f]{24}$/.test(manifest.runId))throw Error('运行清单无效');
 const expected=['history.json','snapshots.json','python-evidence.json','report.json'];
 if(!manifest.files||Object.keys(manifest.files).sort().join('|')!==expected.sort().join('|'))throw Error('运行文件清单不完整');
 for(const name of expected){
  const f=path.join(dir,name);if(!fs.existsSync(f)||fs.lstatSync(f).isSymbolicLink()||!fs.statSync(f).isFile())throw Error('运行文件缺失或不是普通文件: '+name);
  const data=fs.readFileSync(f),record=manifest.files[name];
  if(!record||record.bytes!==data.length||record.sha256!==sha(data))throw Error('运行文件校验失败: '+name);
 }
 const id=sha(json({schemaVersion:1,inputs:manifest.files,pythonScriptSha256:manifest.pythonExecution?.scriptSha256||null})).slice(0,24);
 if(id!==manifest.runId||path.basename(dir)!==id)throw Error('运行标识不匹配');
 const report=readJson(path.join(dir,'report.json'));
 if(report.canTrade!==false||report.verifiedLive!==false||report.datasetFingerprint!==sha(JSON.stringify(readJson(path.join(dir,'history.json')))))throw Error('报告与历史数据不一致');
 if(replay){
  const history=readJson(path.join(dir,'history.json'));
  const snapshots=readJson(path.join(dir,'snapshots.json'));
  const pythonEvidence=readJson(path.join(dir,'python-evidence.json'));
  const regenerated=runUnifiedStrategyProject(history,{snapshots,pythonEvidence,pythonExecution:manifest.pythonExecution||undefined,splitDay:history.splitDay});
  if(json(regenerated)!==json(report))throw Error('报告无法从已归档输入确定性重放');
 }
 return {verified:true,replayed:replay,runId:id,gate:report.gate};
}
module.exports={makeBundle,verifyBundle};
