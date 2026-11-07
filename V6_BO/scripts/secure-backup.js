#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verify}=require('./disaster-recovery');
const {atomicWrite}=require('../src/core/market-data-center');
const key=(password,salt)=>{if(typeof password!=='string'||password.length<16)throw Error('备份口令至少16字符');return crypto.scryptSync(password,salt,32);};
function encrypt(backupDir,output,password){
 const manifest=verify(backupDir),files=manifest.files.map(x=>({name:x.name,data:fs.readFileSync(path.join(backupDir,x.name)).toString('base64')}));
 const raw=Buffer.from(JSON.stringify({manifest,files}));if(raw.length>64*1024*1024)throw Error('备份超过64MiB限制');
 if(fs.existsSync(output))throw Error('禁止覆盖已有加密备份');
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(password,salt),iv);cipher.setAAD(Buffer.from('V6-BACKUP-1'));
 const data=Buffer.concat([cipher.update(raw),cipher.final()]);atomicWrite(output,JSON.stringify({schemaVersion:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')}));return {encrypted:true,files:files.length};
}
function decrypt(input,destination,password){
 const st=fs.lstatSync(input);if(!st.isFile()||st.isSymbolicLink()||st.size>100*1024*1024)throw Error('加密备份文件无效');
 const e=JSON.parse(fs.readFileSync(input));if(e.schemaVersion!==1)throw Error('备份版本无效');
 const salt=Buffer.from(e.salt,'base64'),iv=Buffer.from(e.iv,'base64'),tag=Buffer.from(e.tag,'base64');if(salt.length!==16||iv.length!==12||tag.length!==16)throw Error('备份加密参数无效');
 const cipher=crypto.createDecipheriv('aes-256-gcm',key(password,salt),iv);cipher.setAAD(Buffer.from('V6-BACKUP-1'));cipher.setAuthTag(tag);
 const raw=Buffer.concat([cipher.update(Buffer.from(e.ciphertext,'base64')),cipher.final()]);const value=JSON.parse(raw);
 const dest=path.resolve(destination);if(fs.existsSync(dest))throw Error('恢复目录必须不存在');
 fs.mkdirSync(path.dirname(dest),{recursive:true});const stage=fs.mkdtempSync(path.join(path.dirname(dest),'.restore-'));
 try{if(!Array.isArray(value.files))throw Error('备份内容无效');const seen=new Set();for(const f of value.files){if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(f.name)||f.name==='manifest.json'||seen.has(f.name))throw Error('备份文件名无效');seen.add(f.name);fs.writeFileSync(path.join(stage,f.name),Buffer.from(f.data,'base64'),{mode:0o600,flag:'wx'});}fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(value.manifest),{mode:0o600});verify(stage);fs.renameSync(stage,dest);return {restored:true,files:value.files.length};}finally{fs.rmSync(stage,{recursive:true,force:true});}
}
if(require.main===module){try{const [action,source,dest]=process.argv.slice(2);if(!source||!dest||!['encrypt','decrypt'].includes(action))throw Error('用法: secure-backup.js encrypt|decrypt <源> <目标>；口令通过V6_BACKUP_PASSWORD');console.log(JSON.stringify((action==='encrypt'?encrypt:decrypt)(source,dest,process.env.V6_BACKUP_PASSWORD)));}catch{console.error('备份操作失败：请检查口令、完整性、路径和权限');process.exitCode=1;}}
module.exports={encrypt,decrypt};
