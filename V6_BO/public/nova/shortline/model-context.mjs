import {factorPacket,factorDictionary} from './factor-dictionary.mjs';

const putError=msg=>{throw Error('模型词典 · '+msg);};
const validCode=c=>typeof c==='string'&&/^[A-Z]{2}-\d{2,3}$/.test(c);
const safeVersion=x=>typeof x==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(x);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const sameMap=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const entryShape=e=>({code:e.code,name:e.name,group:e.group,meaning:e.meaning||'',...(e.conditions?{conditions:[...e.conditions]}:{})});

// The sender takes the receiver's acknowledged dictionary version. A fresh
// or restarted receiver has no acknowledgment and must obtain a complete map.
export function modelFrame(packet,dictionary,acknowledged=''){
  if(!safeVersion(dictionary?.version)||packet?.dictionary!==dictionary.version||!Array.isArray(packet.records))putError('数据包与映射版本不一致');
  return {dictionary:dictionary.version,scope:packet.scope,asOf:packet.asOf,records:packet.records,
    ...(acknowledged===dictionary.version?{}:{mapping:dictionary.entries.map(entryShape)})};
}

export function createModelContext(){
  let version='',entries=null;
  function accept(frame){
    if(!frame||!safeVersion(frame.dictionary)||!Array.isArray(frame.records)||frame.records.length>100||!Number.isFinite(Date.parse(frame.asOf)))putError('上下文格式无效');
    const refresh=Array.isArray(frame.mapping);
    if(frame.mapping!==undefined&&!refresh)putError('映射内容无效');
    if(!refresh&&(!entries||version!==frame.dictionary))putError('需重传完整映射');
    let index=entries;
    if(refresh){
      if(!frame.mapping.length||frame.mapping.length>500)putError('映射规模无效');
      index=new Map();
      for(const e of frame.mapping){
        if(!e||!validCode(e.code)||index.has(e.code)||typeof e.name!=='string'||!e.name||e.name.length>100||
          typeof e.group!=='string'||e.group.length>60||typeof e.meaning!=='string'||e.meaning.length>250||
          e.conditions!==undefined&&(!Array.isArray(e.conditions)||e.conditions.length>50||e.conditions.some(c=>typeof c!=='string'||c.length>250)))putError('释义或原条件无效');
        index.set(e.code,entryShape(e));
      }
      if(version===frame.dictionary&&entries&&!sameMap([...entries],[...index]))putError('同一版本的映射发生冲突');
    }
    const summarized=new Map();
    for(const r of frame.records){
      if(!r||!/^\d{6}$/.test(r.stock)||!validDay(r.date)||Date.parse(r.date+'T00:00:00+08:00')>Date.parse(frame.asOf)||
         !Array.isArray(r.matched)||r.matched.length>500||!Array.isArray(r.observed)||r.observed.length>500||!r.conditions||typeof r.conditions!=='object'||Array.isArray(r.conditions))putError('压缩记录无效');
      const count=(code,k)=>{
        if(!index.has(code))putError('未知代号 '+String(code).slice(0,24));
        if(!summarized.has(code))summarized.set(code,{code,matched:0,observed:0,conditions:new Set()});
        if(k)summarized.get(code)[k]++;
      };
      for(const code of new Set(r.matched)){if(!code?.startsWith('YZ-'))putError('完整匹配须为原战法或风控');count(code,'matched');}
      for(const code of new Set(r.observed)){if(typeof code!=='string'||code.startsWith('YZ-'))putError('观测类型错误');count(code,'observed');}
      for(const [code,ordinals] of Object.entries(r.conditions)){
        if(!code.startsWith('YZ-')||(!Array.isArray(ordinals)||ordinals.length>50))putError('条件记录无效');count(code);
        for(const n of ordinals){
          if(!Number.isSafeInteger(n)||n<1||n>(index.get(code).conditions?.length||0))putError('原条件序号越界');
          summarized.get(code).conditions.add(n);
        }
      }
    }
    // An invalid payload must not advance the version acknowledged to the sender.
    entries=index;version=frame.dictionary;
    return [...summarized.values()].map(x=>({...x,conditions:[...x.conditions].sort((a,b)=>a-b),name:index.get(x.code).name}));
  }
  return {ack:()=>version,accept,explain(code,ordinal){const e=entries?.get(code);return ordinal==null?e?.meaning:e?.conditions?.[ordinal-1];}};
}

const localSessions=new WeakMap();
export function reviewFactorReferences(checks,catalog,asOf){
  if(!Array.isArray(catalog)||!checks?.length||!Number.isFinite(asOf))return [];
  const dict=factorDictionary(catalog),packet=factorPacket({checks,catalog,scope:'review'},asOf);
  if(!packet.records.length)return [];
  let receiver=localSessions.get(catalog);
  if(!receiver){receiver=createModelContext();localSessions.set(catalog,receiver);}
  const frame=modelFrame(packet,dict,receiver.ack());
  return receiver.accept(frame).sort((a,b)=>(b.observed+b.matched)-(a.observed+a.matched)||a.code.localeCompare(b.code));
}

export function presentReference(x){
  return x.code+' · '+x.name+'　'+[x.matched?'完整命中 '+x.matched+' 次':'',x.observed?'有据观测 '+x.observed+' 次':'',
    x.conditions.length?'已观察条件序号 '+x.conditions.join('、'):''].filter(Boolean).join('，');
}
