const samples=new Set(['all','standard','blackSwan','extreme','excludeBlackSwan','excludeExtreme']);
const memory=new Map();
export function sampleFor(book,value){
  if(samples.has(value))memory.set(book,value);
  return memory.get(book)||'standard';
}
export function linkedPage(page,context={}){
  const search=new URLSearchParams();
  for(const key of ['code','date','sample','strategy','factor','ref']){
    const v=context[key];if(typeof v==='string'&&v.length>0&&v.length<=120)search.set(key,v);
  }
  return 'shortline-'+page+(search.size?'?'+search.toString():'');
}
export function readContext(extra){
  const q=new URLSearchParams(extra),ctx={};
  for(const key of ['code','date','sample','strategy','factor','ref']){
    const v=q.get(key);if(typeof v==='string'&&v.length<=120&&!/[\u0000-\u001f]/u.test(v))ctx[key]=v;
  }
  if(!/^\d{6}$/.test(ctx.code||''))delete ctx.code;
  if(!/^\d{4}-\d\d-\d\d$/.test(ctx.date||''))delete ctx.date;
  if(!samples.has(ctx.sample))delete ctx.sample;
  return ctx;
}
