'use strict';
const {createPaperMonitor}=require('../src/core/paper-monitor');
const [accountFile,inputFile]=process.argv.slice(2);
try{
 const service=createPaperMonitor({accountFile,inputFile,token:process.env.V6_PAPER_VIEW_TOKEN,port:Number(process.env.V6_PAPER_PORT||8765),pollMs:Number(process.env.V6_PAPER_POLL_MS||60000)});
 service.listen().then(a=>console.log(`V6 本机模拟盘: http://${a.address}:${a.port}/ (只读；每次刷新验证输入数据)`)).catch(e=>{console.error(e.message);process.exitCode=1;});
}catch(e){console.error(e.message);process.exitCode=1;}
