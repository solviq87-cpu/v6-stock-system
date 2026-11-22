'use strict';

const fs=require('node:fs'),path=require('node:path');
const {privateRoot}=require('../core/research-workspace-store');
const {aShareCalendarDate}=require('../core/a-share-calendar');
const activeLeases=new Set();

// Called synchronously by the configuration writer on demotion. A worker
// retains the original, permanently revoked lease across a rapid re-promotion.
function revokeNoticeAuthority(){
  for(const flag of activeLeases)Atomics.store(flag,0,0);
}
function noticeBooks(root){
  const base=privateRoot(root),books=[{book:'main',dir:base}],directory=path.join(base,'books');
  let handle;
  try{
    privateRoot(directory);handle=fs.opendirSync(directory);
    // Account ids are constrained by workbooks.mjs (max. 32 custom books).
    // Avoid loading research.json in the quote/HTTP process.
    for(let i=0;i<128&&books.length<33;i++){
      const entry=handle.readSync();if(!entry)break;
      if(entry.isDirectory()&&/^book-[0-9a-f]{16}$/.test(entry.name))books.push({book:entry.name,dir:path.join(directory,entry.name)});
    }
  }catch(e){if(e.code!=='ENOENT')throw e;}finally{handle?.closeSync();}
  return books.sort((a,b)=>a.book.localeCompare(b.book));
}
function createShortlineNoticeScheduler({root,getMarketSession,isPrimary,runJob,clock=Date.now,listBooks=noticeBooks,hasDue}){
  let pending=false,nextScan=0,latch=null,cursor='',daySeen='';
  const failures=new Map();
  const allowed=at=>{
    if(isPrimary()!==true||!Number.isSafeInteger(at))return null;
    const s=getMarketSession(at),day=aShareCalendarDate(at),local=new Date(at+8*3600000);
    const fromSession=String(s?.day||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    const actual=local.getUTCHours()*60+local.getUTCMinutes();
    return s?.openDay===true&&day===fromSession&&s.minute===actual&&actual>=900?day:null;
  };
  return async function tick(){
    const now=clock(),day=allowed(now);
    if(!day){if(latch)Atomics.store(latch,0,0);return {scheduled:0};}
    if(pending||now<nextScan)return {scheduled:0};
    pending=true;nextScan=now+30000;
    if(day!==daySeen){daySeen=day;cursor='';failures.clear();}
    let scheduled=0,watch;
    try{
      const due=hasDue||(await import('./shortline/web-notices.mjs')).hasDueWebNotices;
      if(allowed(clock())!==day)return {scheduled};
      const books=listBooks(root),last=books.findIndex(b=>b.book===cursor);
      const ordered=last<0?books:books.slice(last+1).concat(books.slice(0,last+1));
      for(const {book,dir} of ordered){
        if(book!=='main'&&!/^book-[0-9a-f]{16}$/.test(book))continue;
        const time=clock();
        if(allowed(time)!==day||scheduled>=8||time-now>=15000)break;
        if(failures.get(book)?.at>time)continue;
        let ready;
        try{ready=due({dir,day,now:time});}catch{ready=false;failures.set(book,{count:1,at:time+120000});}
        if(!ready)continue;
        if(!latch){
          latch=new Int32Array(new SharedArrayBuffer(4));Atomics.store(latch,0,1);activeLeases.add(latch);
          watch=setInterval(()=>{try{if(allowed(clock())!==day)Atomics.store(latch,0,0);}catch{Atomics.store(latch,0,0);}},250);
          watch.unref();
        }
        if(!Atomics.load(latch,0)||allowed(clock())!==day)break;
        cursor=book;scheduled++;
        let result;
        try{result=await runJob({action:'shortline-web-notices',root,book,day,now:time,primaryFlag:latch.buffer});}catch{}
        if(!result?.ok){
          const count=(failures.get(book)?.count||0)+1;
          failures.set(book,{count,at:time+Math.min(300000,30000*2**Math.min(count,4))});
          // The shared worker queue gives interactive requests priority.
          if(result?.httpStatus===503)break;
        }else failures.delete(book);
      }
      return {scheduled};
    }finally{
      clearInterval(watch);
      if(latch){Atomics.store(latch,0,0);activeLeases.delete(latch);latch=null;}
      pending=false;
    }
  };
}
module.exports={createShortlineNoticeScheduler,revokeNoticeAuthority,noticeBooks};
