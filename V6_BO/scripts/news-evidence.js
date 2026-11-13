#!/usr/bin/env node
'use strict';
// Operator-only import. Client requests never choose an archive path.
const fs=require('node:fs');
const journal=require('../src/core/news-evidence-journal');
function main(args=process.argv.slice(2)){
 const root=process.env.V6_NEWS_EVIDENCE_DIR||journal.ROOT;
 if(args[0]==='list'&&args.length<=2)return journal.query(root,{symbol:args[1]||null});
 if(args[0]!=='import'||args.length!==2)throw Error('usage: news-evidence.js import <private-input.json> | list [six-digit-symbol]');
 const file=journal.safePath(args[1]);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let input;
 try{
  const a=fs.fstatSync(fd);if(!a.isFile()||a.size<2||a.size>2*1024*1024)throw Error('INVALID_IMPORT_FILE');
  const raw=fs.readFileSync(fd,'utf8'),b=fs.fstatSync(fd);
  if(a.size!==b.size||a.mtimeMs!==b.mtimeMs||Buffer.byteLength(raw)!==a.size)throw Error('IMPORT_CHANGED_DURING_READ');
  input=JSON.parse(raw);
 }finally{fs.closeSync(fd);}
 return journal.appendBatch(root,Array.isArray(input)?input:[input]);
}
if(require.main===module){try{console.log(JSON.stringify(main()));}catch(e){
 console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,160),...journal.FLAGS}));process.exitCode=1;
}}
module.exports={main};
