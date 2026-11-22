import {directories} from './ths-board-directory.mjs';

export function thsStockLink(code){
  if(typeof code!=='string'||!/^(?:60|68|00|30|43|83|87|88|92)\d{4}$/.test(code))return null;
  return {url:'https://stockpage.10jqka.com.cn/'+code+'/',kind:'stock',label:'同花顺个股行情'};
}
export function thsBoardLink(theme){
  const name=typeof theme==='string'?theme:theme?.name;
  if(typeof name!=='string'||!name.trim()||name.length>60||/[<>\u0000-\u001f]/.test(name))return null;
  const items=Array.isArray(theme?.refs)?theme.refs:[],kinds=theme?.kind==='unknown'?['gn','thshy']:[theme?.kind==='industry'?'thshy':'gn'];
  const raw=new Set([name.trim(),...items.filter(e=>!e.kind||e.kind===theme?.kind).map(e=>e.rawName).filter(Boolean)]);
  // A THS export may carry an 885xxx quote ID, whereas the concept detail
  // URL uses a 30xxxx page ID. Require the directory's exact displayed name.
  const matches=kinds.flatMap(kind=>directories[kind].filter(([,n])=>raw.has(n)).map(([id,n])=>({kind,id,name:n})));
  const exact=matches.filter(item=>item.name===name.trim());
  const target=exact.length===1?exact[0]:matches.length===1?matches[0]:null;
  if(target)return {url:'https://q.10jqka.com.cn/'+target.kind+'/detail/code/'+target.id+'/',kind:'board',label:'同花顺'+(target.kind==='gn'?'概念':'行业')+' · '+target.name,boardName:target.name,pageId:target.id};
  return {url:'https://www.iwencai.com/unifiedwap/result?w='+encodeURIComponent(name.trim()),kind:'search',label:'同花顺按名称核对 · '+name.trim()};
}
