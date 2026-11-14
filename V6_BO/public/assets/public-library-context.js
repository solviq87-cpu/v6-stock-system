/* Public catalog navigation only; never serializes search text or private research state. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.V6PublicLibraryContext=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const CATEGORIES=Object.freeze(['language','forecast','finance-text','workflow','interface','runtime','evaluation','data']);
 const ADOPTIONS=Object.freeze(['implemented','candidate','reference-only']);
 const ID=/^[A-Za-z0-9_-]{1,48}$/;
 const empty=()=>({category:'',adoption:'',ids:[]});
 function normalize(context,entries){
  const result=empty(),known=new Map();
  for(const entry of Array.isArray(entries)?entries:[]){
   if(entry&&typeof entry.id==='string'&&ID.test(entry.id)&&!known.has(entry.id))known.set(entry.id,known.size);
  }
  if(!context||typeof context!=='object')return result;
  if(CATEGORIES.includes(context.category))result.category=context.category;
  if(ADOPTIONS.includes(context.adoption))result.adoption=context.adoption;
  const chosen=new Set();
  for(const raw of Array.isArray(context.ids)?context.ids:[]){
   if(typeof raw!=='string')continue;
   const id=raw.trim();
   if(ID.test(id)&&known.has(id))chosen.add(id);
   if(chosen.size===3)break;
  }
  result.ids=[...chosen].sort((a,b)=>known.get(a)-known.get(b));
  return result;
 }
 function parseContext(search,entries){
  // Accept location.search, never arbitrary URLs, external paths or executable schemes.
  if(typeof search!=='string'||search.length>4096||(search!==''&&!search.startsWith('?')))return empty();
  const params=new URLSearchParams(search),single=key=>params.getAll(key).length===1?params.get(key):'';
  const ids=single('ids');
  return normalize({category:single('category'),adoption:single('adoption'),ids:ids?ids.split(','):[]},entries);
 }
 function canonicalURL(context,entries){
  const value=normalize(context,entries),params=new URLSearchParams();
  if(value.category)params.set('category',value.category);
  if(value.adoption)params.set('adoption',value.adoption);
  if(value.ids.length)params.set('ids',value.ids.join(','));
  const query=params.toString();
  return '/model-library.html'+(query?'?'+query:'')+(value.ids.length?'#compareHeading':'#catalogHeading');
 }
 return Object.freeze({CATEGORIES,ADOPTIONS,normalize,parseContext,canonicalURL});
});
