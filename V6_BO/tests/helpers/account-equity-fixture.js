'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../../src/core/paper-application-service');
const {aShareCalendarDate}=require('../../src/core/a-share-calendar');
const BASE=Date.parse('2026-11-23T10:00:00+08:00');
function fixture(t,initialCash=100000) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-equity-evidence-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let now=BASE,count=0;
  const service=createPaperApplicationService({file:path.join(root,'authority.json'),clock:()=>now,calendar:{isOpen:()=>true}});
  service.initialize(initialCash);
  function buy(symbol='600000',quantity=100,price=10) {
    const id='buy-'+(++count),day=aShareCalendarDate(now);
    service.submit({orderId:id,symbol,side:'buy',quantity,limitPrice:price,tradeDate:day});
    return service.fill(id,'fill-'+count,{symbol,source:'simulated',provider:'isolated-equity-test',tradeDate:day,timestamp:now,
      price,volumeUnit:'shares',volume:10000000,upperLimit:price*1.1,lowerLimit:price*.9,suspended:false,tradable:true});
  }
  return {root,service,buy,get now(){return now;},setNow(value){now=value;},quote(symbol='600000',price=10,extra={}) {
    return {symbol,price,quoteSource:'tencent',provider:'tencent',quoteAt:now,receivedAt:now,mode:'public-live-unverified',canTrade:true,tradable:true,suspended:false,...extra};
  }};
}
function sealBook(book) {
  const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});
  delete book.fingerprint;book.fingerprint=hash(book);return book;
}
module.exports={BASE,fixture,sealBook};
