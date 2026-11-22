import {dictionaryVersion} from './factor-dictionary.mjs';
let cachedCatalog=null,currentId='main';
const storageKey='v6-shortline-workbook-v1';
const valid=id=>typeof id==='string'&&/^(main|demo|book-[a-f0-9]{16})$/.test(id);
export function activeBook(){
  try{const saved=sessionStorage.getItem(storageKey);if(valid(saved))currentId=saved;}catch{}
  return currentId;
}
export function selectBook(id){
  if(!valid(id))throw Error('研究账户无效');
  currentId=id;
  try{sessionStorage.setItem(storageKey,id);}catch{}
}
export function bookHeaders(book=activeBook()){
  return {'X-V6-Research-Book':book,...(cachedCatalog?{'X-V6-Factor-Version':dictionaryVersion}:{})};
}
export function replaceArchive(state,incoming){
  const match=incoming.dictionaryVersion===dictionaryVersion;
  if(!match)cachedCatalog=null;
  else if(Array.isArray(incoming.catalog))cachedCatalog=incoming.catalog;
  const catalog=incoming.catalog||(match?cachedCatalog:null);
  for(const k of Object.keys(state))if(!Object.hasOwn(incoming,k))delete state[k];
  Object.assign(state,incoming);
  if(catalog)state.catalog=catalog;
}
