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

async function selectedClose({day,latest,recent,previousDay,seatsReady,readCore,readStudy}){
  if(!validDate(day)||!latest||day>latest)return null;
  const archived=day<latest;
  const retainedCore=readCore.retained(day),retainedStudy=readStudy.peek(day);
  const core=hasCloseEvidence(retainedCore,day)?retainedCore:null;
  const study=retainedStudy?.day===day?retainedStudy:null;
  if(archived&&!recent.includes(day)){
    return core||study?{...core,day,dabanke:study}:null;
  }
  const [a,b]=await Promise.allSettled([
    archived&&core?.sealed?.complete&&core.retryAfterMs===null?core:readCore(day,previousDay(day),{seatsReady}),
    readStudy.refresh(day)
  ]);
  const result=a.status==='fulfilled'&&hasCloseEvidence(a.value,day)?a.value:core;
  const extra=b.status==='fulfilled'&&b.value?.day===day?b.value:study;
  if(!hasCloseEvidence(result,day)&&extra?.day!==day)return null;
  return {...result,day,dabanke:extra};
}
module.exports={validDate,recentCloseDays,archivedDays,selectedClose};
