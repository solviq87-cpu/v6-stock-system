'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createTradingCalendar}=require('./trading-calendar');
const finite=Number.isFinite;
const iso=x=>{const s=String(x||'').replace(/-/g,'');return /^\d{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6):'';};
let calendar;
function getCalendar(){
 if(calendar!==undefined)return calendar;
 try {calendar=createTradingCalendar(JSON.parse(fs.readFileSync(process.env.V6_TRADING_CALENDAR_FILE||path.join(__dirname,'../../config/research-calendar-2026.json'),'utf8')));}catch{calendar=null;}
 return calendar;
}
function tradeDay(date){try{return !!getCalendar()?.isOpen(iso(date));}catch{return false;}}
function nextDay(date){try{const c=getCalendar(),d=iso(date);if(!c||!c.isOpen(d))return null;return c.next(d);}catch{return null;}}
function barValid(b){return !!b&&['open','high','low','close','volume'].every(k=>finite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high)&&b.suspended!==true&&b.status!=='suspended';}
function usableBars(signal,k,now=Date.now()){
 const target=nextDay(signal?.date);if(!target||!Array.isArray(k?.rows)||!['qfq','unadjusted'].includes(k.adjust)||typeof k.src!=='string'||!k.src||!Number.isSafeInteger(k.receivedAt)||k.receivedAt<Date.parse(target+'T15:10:00+08:00')||k.receivedAt>now)return null;
 const rows=k.rows,day=iso(signal.date),base=rows.filter(r=>iso(r.date)===day),next=rows.filter(r=>iso(r.date)===target);
 if(base.length!==1||next.length!==1||!barValid(base[0])||!barValid(next[0])||!finite(next[0].pct)||!Number.isSafeInteger(now)||now<Date.parse(target+'T15:10:00+08:00'))return null;
 return {base:base[0],next:next[0],target};
}
function temporalNext(signal){const n=signal?.nd,day=nextDay(signal?.date);return !!day&&iso(n?.date)===day&&n.integrity?.version==='calendar-final-ohlcv-v1'&&n.integrity.targetDate===day&&n.openGap!==undefined&&finite(n.nextPct)&&finite(n.maxGain)&&finite(n.closeGain);}
function validNext(signal){return temporalNext(signal)&&typeof signal.nd.hit==='boolean';}
function validSameDay(s){const r=s?.resolved,d=iso(s?.date);return !!d&&tradeDay(d)&&iso(r?.date)===d&&finite(r?.nextPct)&&finite(r?.maxGain)&&typeof r?.hit==='boolean'&&typeof r?.limitUp==='boolean';}
function hasOutcome(s){return s?.type==='auczt'?validSameDay(s):validNext(s);}
function status(signals,operation){
 const counts={total:0,pending:0,matured:0,live:0,backtest:0,posthoc:0,void:0,invalid:0,malformed:0},byType=Object.create(null);
 for(const s of Array.isArray(signals)?signals:[]){counts.total++;if(!s||typeof s!=='object'||Array.isArray(s)){counts.malformed++;continue;}if(s.void){counts.void++;continue;}if(s.resolved?.mode==='历史回测'){counts.backtest++;continue;}if(['zt','review'].includes(s.type)||(s.type!=='auczt'||validSameDay(s))&&s.resolved?.limitUp&&Number(s.resolved.maxGain||0)<=.5){counts.posthoc++;continue;}
  counts.live++;const type=typeof s.type==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(s.type)?s.type:'other',row=byType[type]||(byType[type]={total:0,matured:0,pending:0,invalid:0});row.total++;
  const key=hasOutcome(s)?'matured':(s.type==='auczt'?s.resolved:s.nd)?'invalid':'pending';counts[key]++;row[key]++;
 }
 return {counts,byType,operation:{...operation},outcomeVersion:'calendar-final-ohlcv-v1'};
}
module.exports={nextDay,tradeDay,barValid,usableBars,temporalNext,validNext,validSameDay,hasOutcome,status};
