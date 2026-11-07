'use strict';
const {createPaperService}=require('../src/core/paper-service');
const accountFile=process.argv[2],token=process.env.V6_PAPER_VIEW_TOKEN;
try{
 const service=createPaperService({accountFile,token,port:Number(process.env.V6_PAPER_PORT||8765)});
 service.listen().then(a=>console.log(`模拟账户只读服务: http://${a.address}:${a.port} (需 Bearer token)`)).catch(e=>{console.error(e.message);process.exitCode=1;});
}catch(e){console.error(e.message);process.exitCode=1;}
