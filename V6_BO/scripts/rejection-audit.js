#!/usr/bin/env node
'use strict';
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRejectionAudit}=require('../src/core/rejection-audit');
const {backupAccountWithAudit,restoreAccountWithAudit}=require('../src/core/authority-audit-backup');
function execute(args){const [action,file,destination,flag]=args;if(action==='verify'&&args.length===2){const account=createPaperApplicationService({file}).read();const s=createRejectionAudit(file+'.audit.json').storageFiles();return {verified:true,accountRevision:account.revision,total:s.total,head:s.head,files:s.files.length};}if(action==='rotate'&&args.length===2){createPaperApplicationService({file}).read();return createRejectionAudit(file+'.audit.json').rotate();}if(action==='backup'&&args.length===3)return backupAccountWithAudit(file,destination);if(action==='restore'&&(args.length===3||args.length===4&&flag==='--apply'))return restoreAccountWithAudit(file,destination,{apply:flag==='--apply'});throw Error('用法: rejection-audit.js verify|rotate <账户文件> | backup <账户文件> <新备份目录> | restore <备份目录> <空目标目录> [--apply]');}
if(require.main===module){try{console.log(JSON.stringify({ok:true,...execute(process.argv.slice(2))}));}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}}
module.exports={execute};
