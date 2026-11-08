#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const {createRegistry}=require('../src/core/learning-profile-registry');
function load(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)throw Error('需要8MiB以内普通JSON');return JSON.parse(fs.readFileSync(file,'utf8'));}
function main(args){const [action,root,...rest]=args;if(!root)throw Error('用法: learning-profile.js freeze <新目录> <input.json> <plan.json>；或 evaluate|holdout|promote|rollback <目录> --expected-revision N；或 status|verify <目录>');const registry=createRegistry(root);
 if(action==='freeze'&&rest.length===2)return registry.freeze(load(rest[0]),load(rest[1]));
 if(action==='status'&&!rest.length)return registry.status();if(action==='verify'&&!rest.length)return registry.verify({replay:true});
 if(action==='promote'&&rest.length===4&&rest[0]==='--expected-revision'&&
  /^\d+$/.test(rest[1])&&Number.isSafeInteger(Number(rest[1]))&&Number(rest[1])>0&&
  rest[2]==='--market-context')
  return registry.promote(Number(rest[1]),{marketContext:load(rest[3])});
 if(!['evaluate','holdout','promote','rollback'].includes(action)||rest.length!==2||rest[0]!=='--expected-revision'||!/^\d+$/.test(rest[1])||!Number.isSafeInteger(Number(rest[1]))||Number(rest[1])<1)throw Error('操作或预期修订无效');
 const method={evaluate:'evaluate',holdout:'testHoldout',promote:'promote',rollback:'rollback'}[action];return registry[method](Number(rest[1]));
}
if(require.main===module){try{console.log(JSON.stringify({ok:true,result:main(process.argv.slice(2))}));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));process.exitCode=1;}}
module.exports={main};
