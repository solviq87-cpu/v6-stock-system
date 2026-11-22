'use strict';

// A bounded reader for the supplier's server-rendered tables. Only text and
// attributes are read. No remote markup is executed or passed to the browser.
const emptyTags=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
function decode(value){
  return value.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,(original,key)=>{
    if(key[0]!=='#')return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[key.toLowerCase()];
    const point=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
  });
}
function parseHTML(input){
  if(typeof input!=='string'||Buffer.byteLength(input)>2*1024*1024)return null;
  const root={tag:'',attrs:{},children:[]},stack=[root];
  const html=input.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const tokens=/<\/?[\w:-]+(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  let nodes=0;
  for(const [token] of html.matchAll(tokens)){
    if(token[0]!=='<'){if(token.trim())stack.at(-1).children.push(decode(token.trim()));continue;}
    const tag=/^<\/?([\w:-]+)/.exec(token)[1].toLowerCase();
    if(token.startsWith('</')){
      for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break;}
      continue;
    }
    if(++nodes>100000||stack.length>96)return null;
    const attrs=Object.create(null);
    for(const m of token.matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');
    const node={tag,attrs,children:[]};stack.at(-1).children.push(node);
    if(!emptyTags.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  return root;
}
function all(root,predicate){
  const result=[];
  function walk(node){
    for(const child of node?.children||[])if(typeof child==='object'){if(predicate(child))result.push(child);walk(child);}
  }
  walk(root);return result;
}
const hasClass=(node,name)=>(node?.attrs.class||'').split(/\s+/).includes(name);
const classes=(node,name)=>all(node,n=>hasClass(n,name));
const byClass=(node,name)=>classes(node,name)[0];
const byId=(node,id)=>all(node,n=>n.attrs.id===id)[0];
const tags=(node,name)=>all(node,n=>n.tag===name);
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ').replace(/\s+/g,' ').trim();
const one=(node,tag)=>text(tags(node,tag)[0]);
const named=(node,cls)=>text(byClass(node,cls));
const clean=s=>typeof s==='string'&&s.length<=320&&!/[<>\u0000-\u001f]/.test(s)?s.trim():'';
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&new Date(d+'T00:00:00Z').toJSON()?.slice(0,10)===d;
function stamp(day,time,knownAt){
  if(!dayOk(day)||!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time||''))return null;
  const at=Date.parse(day+'T'+time+(time.length===5?':00':'')+'+08:00');
  return Number.isSafeInteger(knownAt)&&at<=knownAt?at:null;
}
function number(value){
  const m=/^([+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*(万亿|亿|万|元|%|只|板)?$/.exec(String(value).trim());
  if(!m)return null;
  const n=Number(m[1].replaceAll(',',''))*({万亿:1e12,亿:1e8,万:1e4}[m[2]]||1);
  return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null;
}
function stockLink(node,day,kind='gupiao'){
  const link=node?.tag==='a'?node:tags(node,'a')[0];
  if(!link)return null;
  try{
    const u=new URL(link.attrs.href,'https://www.dabanke.com');
    if(u.origin!=='https://www.dabanke.com'||u.username||u.password)return null;
    const match=kind==='lhbd'?/^\/lhbd-(\d{6})-(\d{8})\.html$/.exec(u.pathname):/^\/gupiao-(\d{6})\.html$/.exec(u.pathname);
    if(!match||match[2]&&match[2]!==day.replaceAll('-','')||u.searchParams.has('review_date')&&u.searchParams.get('review_date')!==day)return null;
    return match[1];
  }catch{return null;}
}
module.exports={parseHTML,all,classes,byClass,byId,tags,text,one,named,clean,dayOk,stamp,number,stockLink,hasClass};
