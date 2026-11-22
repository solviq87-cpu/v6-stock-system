(function(root){
  'use strict';
  const clean=v=>typeof v==='string'?v.trim().slice(0,100):'';
  const codeOK=v=>typeof v==='string'&&/^\d{6}$/.test(v);
  const height=h=>Number.isSafeInteger(h)&&h>=1&&h<=100;
  function canonicalTheme(value){
    const s=clean(value).normalize('NFKC').replace(/\s+/g,' ');
    const exact=s.replace(/\s/g,'').toUpperCase();
    if(['算力','AI算力'].includes(exact))return '算力';
    if(['半导体','芯片'].includes(exact))return '半导体';
    return s;
  }
  function references(value,{provider='',kind='theme',boardCode}={}){
    const list=Array.isArray(value)?value:[value],refs=new Map();
    for(const item of list){
      const input=typeof item==='string'?{name:item}:item||{};
      const names=clean(input.rawName||input.name).split(/[+＋、|；;]/).map(clean).filter(Boolean);
      for(const rawName of names){
        if(/^(其他|其它|未知|未分类|暂无|无|--?|—)$/.test(rawName))continue;
        const id=names.length===1?clean(String(input.boardCode??input.code??boardCode??'')):'';
        const x={name:canonicalTheme(rawName),rawName,provider:clean(input.provider)||provider,kind:clean(input.kind)||kind,boardId:/^[A-Za-z0-9._-]{1,40}$/.test(id)?id:null};
        if(!x.boardId&&/^[A-Za-z0-9._-]{1,40}$/.test(input.boardId||''))x.boardId=input.boardId;
        refs.set(JSON.stringify([x.provider,x.kind,x.boardId,x.rawName]),x);
      }
    }
    return [...refs.values()];
  }
  function sealTime(value){
    let raw=String(value||'');const minuteOnly=/^\d\d:\d\d$/.test(raw);if(minuteOnly)raw+=':00';
    const s=raw.replaceAll(':','').padStart(6,'0');
    if(!/^\d{6}$/.test(s)||+s.slice(-2)>59||+s.slice(2,4)>59)return null;
    const hhmm=s.slice(0,4);
    if(!(hhmm>='0925'&&hhmm<='1130'||hhmm>='1300'&&hhmm<='1500'))return null;
    return s.slice(0,2)+':'+s.slice(2,4)+(minuteOnly?'':':'+s.slice(4));
  }
  const earlier=(a,b)=>a&&b&&(a.length===5?a+':59':a)<(b.length===5?b+':00':b);
  function groupPool(pool,previousPool){
    if(!pool?.date||!Array.isArray(pool.sealed))return [];
    const byCode=new Map();
    for(const row of pool.sealed){
      if(!row||!codeOK(row.code))continue;
      let stock=byCode.get(row.code);
      if(!stock){stock={...row,level:height(row.level)?row.level:null,firstSealTime:sealTime(row.firstSealTime),refs:[]};byCode.set(row.code,stock);}
      else{
        if(height(row.level)&&stock.level!==row.level)stock.level=null;
        if(row.firstSealTime&&stock.firstSealTime!==sealTime(row.firstSealTime))stock.firstSealTime=null;
      }
      stock.refs=references([...stock.refs,...references(row.refs||[],{provider:pool.provider||pool.source})]);
    }
    const groups=new Map(),covers=new Map();
    for(const stock of byCode.values()){
      const dims=new Set(stock.refs.map(x=>x.kind));
      for(const dim of dims)covers.set(dim,(covers.get(dim)||0)+1);
      for(const ref of stock.refs){
        const key=ref.kind+'|'+ref.name;
        let g=groups.get(key);
        if(!g){g={key,name:ref.name,kind:ref.kind,refs:[],members:new Map()};groups.set(key,g);}
        g.refs=references([...g.refs,ref]);g.members.set(stock.code,stock);
      }
    }
    const old=previousPool&&previousPool.date===pool.previousDay&&previousPool.provider===pool.provider&&previousPool.scope===pool.scope?groupPool(previousPool):[];
    return [...groups.values()].map(g=>{
      const members=[...g.members.values()].sort((a,b)=>(b.level||0)-(a.level||0)||a.code.localeCompare(b.code));
      const tagged=covers.get(g.kind)||0,complete=pool.complete===true&&pool.totalCount===byCode.size&&tagged===byCode.size&&members.every(m=>height(m.level));
      const top=Math.max(0,...members.map(m=>m.level||0)),tops=members.filter(m=>m.level===top);
      let leader=null;
      if(complete&&top>=2){
        if(tops.length===1)leader=tops[0];
        else if(tops.every(m=>m.firstSealTime)){const order=tops.slice().sort((a,b)=>a.firstSealTime.localeCompare(b.firstSealTime));if(earlier(order[0].firstSealTime,order[1].firstSealTime))leader=order[0];}
      }
      const prev=old.find(o=>o.key===g.key);
      const roles=members.map(m=>{
        let role='同题材封板',basis='当日来源明确列入同一题材';
        if(leader?.code===m.code){role='已核龙头';basis=tops.length===1?'范围内唯一最高连板':'同高度中唯一最早首封';}
        else if(leader){
          role='助攻';basis='与已核龙头同题材、当日收盘封板';
          if(prev?.leader?.code===leader.code&&prev.leader.level>=2&&leader.level===prev.leader.level+1&&m.level===1&&
             prev.complete&&!previousPool.sealed.some(r=>r.code===m.code)&&earlier(leader.firstSealTime,m.firstSealTime)){
            role='补涨候选';basis='昨日龙头至少二板、今日续板后新首板助攻';
          }
        }
        return {...m,role,basis};
      });
      const levels=[];
      for(let h=top;h>=1;h--){const list=roles.filter(m=>m.level===h);levels.push({level:h,members:list,gap:complete&&!list.length});}
      const gaps=levels.filter(l=>l.gap).map(l=>l.level);
      const unknown=roles.filter(m=>m.level==null);
      return {key:g.key,name:g.name,kind:g.kind,refs:g.refs,members:roles,levels,unknown,leader:leader?{code:leader.code,name:leader.name,level:leader.level}:null,gaps,complete,tagged,totalCount:byCode.size,scope:pool.scope,source:pool.source,date:pool.date,knownAt:pool.knownAt};
    }).sort((a,b)=>b.members.length-a.members.length||a.name.localeCompare(b.name,'zh-CN'));
  }
  const api={canonicalTheme,references,sealTime,groupPool};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V6ShortlineStructure=api;
})(globalThis);
