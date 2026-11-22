'use strict';
const fs=require('node:fs');

function validDate(day){
  return typeof day==='string'&&/^\d{4}-\d\d-\d\d$/.test(day)&&new Date(day+'T00:00:00Z').toJSON()?.slice(0,10)===day;
}

function recentCloseDays(latest,previousDay){
  const days=[];
  let day=latest;
  while(days.length<5&&validDate(day)){
    days.push(day);
    const prior=previousDay(day);
    if(!prior||prior>=day)break;
    day=prior;
  }
  return days;
}

// Read the names only. The owning reader validates the file contents on selection.
function archivedDays(directories,latest,isTradingDay){
  const result=new Set();
  for(const dir of directories){
    let entries;
    try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
    for(const entry of entries){
      if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
      const day=entry.name.slice(0,-5);
      if(validDate(day)&&day<=latest&&isTradingDay(day))result.add(day);
    }
  }
  return [...result].sort().reverse().slice(0,120);
}

function hasCloseEvidence(report,day){
  if(!report||report.day!==day)return false;
  return [report.sealed,report.broken].some(p=>p?.tradeDate===day&&p.complete)||
    Number.isSafeInteger(report.down)||Number.isFinite(report.marketTurnover)||Number.isFinite(report.northTurnover)||
    report.thsBrief?.day===day||Boolean(report.reasons?.length||report.seats?.length);
}

function retainedClose(day,readCore,readStudy){
  if(!validDate(day))return null;
  const report=readCore.retained(day),extra=readStudy.peek(day);
  const core=hasCloseEvidence(report,day)?report:null,study=extra?.day===day?extra:null;
  return core||study?{...core,day,dabanke:study}:null;
}

async function selectedClose({day,latest,recent,previousDay,seatsReady,readCore,readStudy,serveAfterMs}){
  if(!validDate(day)||!latest||day>latest)return null;
  const archived=day<latest;
  const retained=retainedClose(day,readCore,readStudy);
  if(archived&&!recent.includes(day))return retained;
  const core=hasCloseEvidence(retained,day)?retained:null;
  let report=core,extra=retained?.dabanke||null,signalReceipt;
  const available=new Promise(resolve=>{signalReceipt=resolve;});
  const compose=()=>report||extra?{...report,day,dabanke:extra}:null;
  if(compose())signalReceipt();
  const completed=Promise.allSettled([
    (async()=>{
      const fresh=archived&&core?.sealed?.complete&&core.retryAfterMs===null?core:await readCore(day,previousDay(day),{seatsReady});
      if(hasCloseEvidence(fresh,day)){report=fresh;signalReceipt();}
    })(),
    (async()=>{
      const fresh=await readStudy.refresh(day);
      if(fresh?.day===day){extra=fresh;signalReceipt();}
    })()
  ]).then(compose);
  if(!Number.isFinite(serveAfterMs))return completed;
  // A slow supplier must not keep an already received same-day report off screen.
  let timer;
  const grace=new Promise(resolve=>{timer=setTimeout(resolve,serveAfterMs);});
  try{
    return await Promise.race([completed,Promise.all([grace,available]).then(()=>({...compose(),refreshPending:true}))]);
  }finally{clearTimeout(timer);}

}
module.exports={validDate,recentCloseDays,archivedDays,retainedClose,selectedClose};
