'use strict';

// Runs inside V6's existing close-snapshot timer. The archive worker still owns
// validation, revision checks, atomic writes, samples and the daily report.
function createShortlineCloseRunner({session, isReplica, pool, readSource, job, root, requirePressure=false, clock=Date.now}) {
  let pending=false,lastDay='',nextAt=0;
  const handled=new Set(),attempted=new Map();
  const observed=market=>market&&['upLimit','downLimit','height','breakRate','leader','diffusion'].every(k=>Number.isFinite(market[k]))&&!!market.trend;
  const scanned=(report,day,code)=>!requirePressure||(report?.day===day&&report.code===code&&
    ['notices','goodwill','unlock','reduction'].every(kind=>report.coverage?.some(r=>r.id===kind&&['已检索','仅前两页'].includes(r.status))));
  return async function tick(){
    const now=clock(), s=session();
    if(pending||isReplica()||!s.openDay||s.minute<915||now<nextAt)return;
    const day=s.day.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    if(day!==lastDay){lastDay=day;handled.clear();attempted.clear();}
    const codes=[...new Set(pool().map(row=>typeof row==='string'?row:row?.code).filter(x=>typeof x==='string'&&/^\d{6}$/.test(x)))];
    const code=codes.find(x=>!handled.has(x)&&!attempted.has(x))||
      codes.filter(x=>!handled.has(x)&&now-attempted.get(x)>=15*60000).sort((a,b)=>attempted.get(a)-attempted.get(b))[0];
    if(!code)return;
    pending=true;attempted.set(code,now);nextAt=now+60000;
    try{
      const archive=await job({action:'shortline',root,replica:false});
      if(!archive.ok||isReplica())return;
      const previous=archive.state.checks.find(c=>c.code===code&&c.date===day&&c.sourceFingerprint&&c.market?.date===day&&observed(c.market));
      const report=archive.state.pressureHistory?.find(r=>r.code===code&&r.day===day);
      if(previous&&scanned(report,day,code)){handled.add(code);return;}
      const snapshot=await readSource({code,day});
      if(isReplica()||!snapshot?.latestClosed||snapshot.day!==day||snapshot.code!==code)return;
      const result=await job({action:'shortline',root,replica:false,snapshot,
        input:{action:'v6:sync',revision:archive.state.revision,payload:{code,day}}});
      if(result.ok&&(!Array.isArray(snapshot.market)||observed(snapshot.market.find(m=>m.date===day)))&&
         scanned(snapshot.stock?.pressure,day,code))handled.add(code);
    }finally{pending=false;}
  };
}
module.exports={createShortlineCloseRunner};
