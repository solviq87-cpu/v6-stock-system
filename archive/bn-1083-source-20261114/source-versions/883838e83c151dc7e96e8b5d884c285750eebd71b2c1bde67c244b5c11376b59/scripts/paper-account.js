#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
function execute(file,request){
 const calendar=process.env.V6_TRADING_CALENDAR_FILE?require('../src/core/trading-calendar').createTradingCalendar(JSON.parse(fs.readFileSync(process.env.V6_TRADING_CALENDAR_FILE,'utf8'))):null;
 const service=createPaperApplicationService({file,calendar});
 switch(request.action){
  case 'initialize':return service.initialize(request.initialCash);
  case 'submit':return service.submit(request.order,{riskContext:request.riskContext});
  case 'fill':return service.fill(request.orderId,request.eventId,request.quote);
  case 'configure':return service.configure(request.configuration);
  case 'cancel':return service.cancel(request.orderId,request.eventId);
  case 'read':return service.read();
  default:throw Error('未知账户操作');
 }
}
if(require.main===module){try{const [file,input]=process.argv.slice(2);if(!file||!input)throw Error('用法: node scripts/paper-account.js <权威账户文件> <请求JSON文件>');console.log(JSON.stringify({ok:true,paperOnly:true,result:execute(file,JSON.parse(fs.readFileSync(input,'utf8')))}));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,200)}));process.exitCode=1;}}
module.exports={execute};
