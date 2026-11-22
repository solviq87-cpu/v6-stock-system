'use strict';

const {aShareCalendarDate}=require('./a-share-calendar');
const {normalizeDay}=require('./limit-reason-evidence');

function parseThsRealhead(text,code,receivedAt){
 const wire=/^\s*quotebridge_v6_realhead_hs_(\d{6})_last\(([\s\S]*)\);?\s*$/.exec(text);
 if(!wire||wire[1]!==code)return null;
 const items=JSON.parse(wire[2])?.items;
 if(!items||typeof items!=='object'||Array.isArray(items))return null;
 const clock=/^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(items.updateTime||'');
 const day=clock&&normalizeDay(clock[1]);
 const at=day?Date.parse(day+'T'+clock[2]+':'+clock[3]+':'+(clock[4]||'00')+'+08:00'):null;
 const matched=Number.isSafeInteger(at)&&at>0&&at<=receivedAt;
 return {items,providerUpdatedAt:matched?at:null,providerTradeDate:matched?day:null};
}

function currentThsSnapshot(row,now=Date.now()){
 const at=row?.providerUpdatedAt;
 return Number.isSafeInteger(at)&&at>0&&at<=now&&now-at<=180000&&
  aShareCalendarDate(at)===aShareCalendarDate(now)&&row.providerTradeDate===aShareCalendarDate(at);
}

module.exports={parseThsRealhead,currentThsSnapshot};
