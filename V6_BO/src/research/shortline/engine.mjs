import {autoValidate,normalizeMarket} from '../../../public/nova/shortline/market.mjs';
import {learningAction} from '../../../public/nova/shortline/learning.mjs';
import {backtestAction} from '../../../public/nova/shortline/backtest.mjs';
import {reviewAction} from '../../../public/nova/shortline/review.mjs';
export function mutate(state,action,payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('记录格式无效');
 if(action==='market'){
  const row=normalizeMarket(payload);
  const previous=state.market.find(x=>x.date===row.date);
  const nowCN=new Date(Date.now()+8*3600000).toISOString().slice(0,16).replace('T',' ');
  if(row.date+' 15:00'>nowCN)throw Error('仅支持已收盘的交易日期');
  row.availableAt=nowCN;
  row.recordedAt=new Date().toISOString();
  row.source=previous?'人工修订':'人工历史收盘观测';
  if(previous)(state.marketHistory||=[]).push(previous);
  state.market=state.market.filter(x=>x.date!==row.date).concat(row).sort((a,b)=>a.date.localeCompare(b.date));return row;
 }
 if(action==='check'){
  const r={...autoValidate(state,payload),id:crypto.randomUUID(),createdAt:new Date().toISOString()};state.checks.push(r);return r;
 }
 if(action.startsWith('learn:'))return learningAction(state,action,payload);
 if(action.startsWith('k:')){const result=backtestAction(state,action,payload);learningAction(state,'learn:auto-candidate',{});return result}
 if(action.startsWith('review:')){const result=reviewAction(state,action,payload);if(action==='review:note')learningAction(state,'learn:auto-candidate',{});return result}
 throw Error('未知操作')
}
