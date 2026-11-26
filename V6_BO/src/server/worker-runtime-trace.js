'use strict';
// Internal worker transport only. Strip transport fields before the original
// research code sees the payload or a caller receives its business result.
const trace=require('../core/runtime-trace');
const KEY='__v6WorkerTraceV1';
function payload(value){return {...value,[KEY]:trace.workerContext()};}
function take(value){const parent=value?.[KEY];delete value[KEY];return parent;}
function mark(span,value){if(value?.ok===false){
 if([403,409].includes(value.httpStatus))span.mark('blocked','BUSINESS_REJECTED');
 else span.mark('failed','STAGE_FAILED');
}}
async function execute(parent,stage,fn){
 const result=await trace.inWorker(parent,()=>trace.async(stage,async span=>{const value=await fn();mark(span,value);return value;}));
 return {[KEY]:true,result,receipt:trace.workerReceipt(parent)};
}
function receive(parent,stage,value,span){
 if(value?.[KEY]===true){const valid=trace.importWorkerReceipt(parent,value.receipt,stage);mark(span,value.result);
  if(!valid&&value.result?.ok!==false)span.mark('unknown');return value.result;
 }
 // The original failure/timeout or a legacy worker remains a business result.
 // No synthetic execution receipt is created.
 mark(span,value);if(value?.ok!==false)span.mark('unknown');return value;
}
module.exports={payload,take,execute,receive,mark,trace};
