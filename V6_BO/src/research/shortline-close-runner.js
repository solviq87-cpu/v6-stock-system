'use strict';

// Runs inside V6's existing close-snapshot timer. The archive worker still owns
// validation, revision checks, atomic writes, samples and the daily report.
function createShortlineCloseRunner({session, isReplica, pool, readSource, job, root, clock=Date.now}) {
  let pending=false,lastDay='',nextAt=0;
  const handled=new Set(),attempted=new Map();
  const observed=market=>market&&['upLimit','downLimit','height','breakRate','leader','diffusion'].every(k=>Number.isFinite(market[k]))&&!!market.trend;
  return async function tick(){
    const now=clock(), s=session();
    if(pending||isReplica()||!s.openDay||s.minute<915||now<nextAt)return;
    const day=s.day.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    if(day!==lastDay){lastDay=day;handled.clear();attempted.clear();}
    const codes=[...new Set(pool().map(row=>typeof row==='string'?row:row?.code).filter(x=>typeof x==='string'&&/^\d{6}$/.test(x)))];
    const code=codes.find(x=>!handled.has(x)&&(!attempted.has(x)||now-attempted.get(x)>=15*60000));
    if(!code)return;
    pending=true;attempted.set(code,now);nextAt=now+60000;
    try{
      const archive=await job({action:'shortline',root,replica:false});
      if(!archive.ok||isReplica())return;
      const previous=archive.state.checks.find(c=>c.code===code&&c.date===day&&c.sourceFingerprint&&c.market?.date===day&&observed(c.market));
      if(previous){handled.add(code);return;}
      const snapshot=await readSource({code,day});
      if(isReplica()||!snapshot?.latestClosed||snapshot.day!==day||snapshot.code!==code)return;
      const result=await job({action:'shortline',root,replica:false,snapshot,
        input:{action:'v6:sync',revision:archive.state.revision,payload:{code,day}}});
      if(result.ok&&(!Array.isArray(snapshot.market)||observed(snapshot.market.find(m=>m.date===day))))handled.add(code);
    }finally{pending=false;}
  };
}
module.exports={createShortlineCloseRunner};
