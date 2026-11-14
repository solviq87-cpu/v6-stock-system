#!/usr/bin/env node
'use strict';
// Read-only preflight for a private, independently obtained WorkBuddy records export.
// This NEVER imports, initializes, restores, posts, publishes, or changes account data.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {inspectBackupCandidate}=require('../src/core/cloud-records-cas-store');
const MAX_BYTES=32*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const REPO_ROOT=path.resolve(__dirname,'../..');
function fault(code) {const e=new Error(code);e.code=code;return e;}
function approvedPath(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))
    throw fault('PRIVATE_ABSOLUTE_PATH_REQUIRED');
  const full=path.resolve(file);
  if(full===REPO_ROOT||full.startsWith(REPO_ROOT+path.sep) ||
     full.split(path.sep).some(x=>/^(public|www|htdocs|dist)$/i.test(x)))
    throw fault('BACKUP_MUST_BE_OUTSIDE_PUBLIC_REPOSITORY');
  let cursor=path.parse(full).root;
  for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    try{if(fs.lstatSync(cursor).isSymbolicLink())throw fault('SYMLINK_PATH_FORBIDDEN');}
    catch(e){if(e.code==='ENOENT')throw fault('BACKUP_FILE_MISSING');throw e;}
  }
  return full;
}
function readPrivate(file) {
  const full=approvedPath(file);
  let fd;
  try{fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));}
  catch{throw fault('BACKUP_OPEN_DENIED');}
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||(before.mode&0o077)!==0)
      throw fault('BACKUP_NOT_PRIVATE_REGULAR_FILE');
    if(before.size<=0||before.size>MAX_BYTES)throw fault('BACKUP_SIZE_UNSUPPORTED');
    const bytes=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(bytes.length!==before.size||after.size!==before.size||
       before.mtimeMs!==after.mtimeMs)throw fault('BACKUP_CHANGED_DURING_READ');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function preview({file,expectedFileSha256}={}) {
  if(expectedFileSha256!==undefined&&(!HASH.test(expectedFileSha256)))
    throw fault('EXPECTED_SHA256_INVALID');
  const bytes=readPrivate(file);
  const fileSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(expectedFileSha256!==undefined&&fileSha256!==expectedFileSha256)
    throw fault('SOURCE_FILE_SHA256_MISMATCH');
  let doc;
  try{doc=JSON.parse(bytes.toString('utf8'));}
  catch{throw fault('BACKUP_JSON_INVALID');}
  if(!doc||Array.isArray(doc)||doc.ok!==true||!Array.isArray(doc.records))
    throw fault('WORKBUDDY_RECORDS_CONTRACT_INVALID');
  let inspected;
  try{inspected=inspectBackupCandidate(doc.records);}
  catch(e) {
    // Map all untrusted structural or parsing errors to known redacted codes.
    const allowed=new Set(['DUPLICATE_RECORD_NAME','INVALID_ACCOUNT_JSON','INVALID_ACCOUNT_SHAPE',
      'MISSING_AUTHORITATIVE_ACCOUNT','INVALID_RECORD','INVALID_RECORDS_ARRAY',
      'UNSAFE_JSON_FIELD','UNSAFE_JSON_PROTOTYPE','STRUCTURE_TOO_DEEP']);
    throw fault(allowed.has(e.code)?e.code:'BACKUP_RECORDS_INVALID');
  }
  return Object.freeze({
    schemaVersion:1,status:expectedFileSha256?'file-hash-matched-structure-only':'structure-only',
    sourceFileSha256:fileSha256,
    expectedFileSha256Matched:expectedFileSha256===undefined?null:true,
    sourceFileBytes:bytes.length,
    ...inspected,
    readOnly:true,
    accountHistoryReconciled:false,
    restorePerformed:false,
    backupAuthorityVerified:false,
    productionDataModified:false
  });
}
function main(){
  try{
    const result=preview({file:process.env.V6_CLOUD_RECORDS_BACKUP_FILE,
      expectedFileSha256:process.env.V6_CLOUD_RECORDS_BACKUP_SHA256||undefined});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(e){
    const known=new Set(['PRIVATE_ABSOLUTE_PATH_REQUIRED','BACKUP_MUST_BE_OUTSIDE_PUBLIC_REPOSITORY',
      'SYMLINK_PATH_FORBIDDEN','BACKUP_FILE_MISSING','BACKUP_OPEN_DENIED',
      'BACKUP_NOT_PRIVATE_REGULAR_FILE','BACKUP_SIZE_UNSUPPORTED','BACKUP_CHANGED_DURING_READ',
      'EXPECTED_SHA256_INVALID','SOURCE_FILE_SHA256_MISMATCH','BACKUP_JSON_INVALID',
      'WORKBUDDY_RECORDS_CONTRACT_INVALID','DUPLICATE_RECORD_NAME','INVALID_ACCOUNT_JSON',
      'INVALID_ACCOUNT_SHAPE','MISSING_AUTHORITATIVE_ACCOUNT','INVALID_RECORD',
      'INVALID_RECORDS_ARRAY','UNSAFE_JSON_FIELD','UNSAFE_JSON_PROTOTYPE',
      'STRUCTURE_TOO_DEEP','BACKUP_RECORDS_INVALID']);
    process.stdout.write(JSON.stringify({schemaVersion:1,status:'blocked',
      code:known.has(e.code)?e.code:'READ_ONLY_PREFLIGHT_FAILED',
      readOnly:true,restorePerformed:false,productionDataModified:false})+'\n');
    process.exitCode=2;
  }
}
if(require.main===module)main();
module.exports={preview};
