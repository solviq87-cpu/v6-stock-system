'use strict';
const path=require('node:path');
const {createPaperAccountLedger}=require('../src/core/paper-account-ledger');
const {createPaperTransactionCoordinator}=require('../src/core/paper-transaction-coordinator');
function main(argv){const [accountFile,journalDir]=argv;if(!accountFile||!journalDir){console.error('用法：node scripts/paper-transaction-recover.js <account.json> <transaction-journal-dir>');process.exitCode=1;return;}
 const ledger=createPaperAccountLedger(path.resolve(accountFile));const coordinator=createPaperTransactionCoordinator({ledger,journalDir:path.resolve(journalDir)});const result=coordinator.recover();process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.results.some(x=>x.status==='busy'))process.exitCode=2;}
if(require.main===module)main(process.argv.slice(2));module.exports={main};
