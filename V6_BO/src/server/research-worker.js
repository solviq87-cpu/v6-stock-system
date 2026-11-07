'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage({ok:true,result:require('../core/complete-workbench').runCompleteWorkbench(workerData)});}
catch(e){parentPort.postMessage({ok:false,error:String(e.message).slice(0,240)});}
