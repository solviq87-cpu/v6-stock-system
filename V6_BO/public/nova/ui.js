const eventBindings=new WeakMap();
function bindEvent(node,name,handler){
 let events=eventBindings.get(node);
 if(!events){events=new Map();eventBindings.set(node,events);}
 if(!events.has(name))node.addEventListener(name,event=>events.get(name)?.(event));
 events.set(name,handler);
}
// Update presentation nodes in place. Keys keep the same security's row and
// keyboard focus across rank changes. Disclosure and form state belong to the reader.
export function updateReadout(parent,...children){
 const incoming=children.flat().filter(node=>node instanceof Node);
 if(!parent.firstChild){
  if(parent.children?.length&&parent.replaceChildren)parent.replaceChildren(...incoming);
  else parent.append(...incoming);
  return;
 }
 const key=node=>node?.nodeType===1?(node.dataset?.code||node.id||node.getAttribute('data-fast-section')||''):'';
 function sync(host,nodes){
  const keyed=new Map([...host.children].filter(node=>key(node)).map(node=>[key(node),node]));
  for(const [index,next] of nodes.entries()){
   let old=host.childNodes[index];
   const id=key(next),same=id&&keyed.get(id);
   if(same&&same!==old){
    if(host.moveBefore)host.moveBefore(same,old||null);else host.insertBefore(same,old||null);
    old=same;
   }
   if(!old){host.append(next);continue;}
   if(old===next)continue;
   if(old.nodeName!==next.nodeName||key(old)!==id){host.insertBefore(next,old);if(!key(old)||!nodes.some(n=>key(n)===key(old)))old.remove();continue;}
   if(old.nodeType===3){if(old.data!==next.data)old.data=next.data;continue;}
   if(old.nodeType!==1)continue;
   const managed=eventBindings.get(next),previous=eventBindings.get(old);
   // Keep one listener per event name. Disable only handlers owned by h()
   // when the next readout no longer exposes them, without removing unrelated
   // listeners or adding duplicate wrappers if the action later returns.
   if(previous)for(const name of previous.keys())if(!managed?.has(name))previous.set(name,null);
   if(managed)for(const [name,fn] of managed)bindEvent(old,name,fn);
   if(old.matches('input,textarea,select')){
    // The user's draft/selection stays local. Availability and accessibility
    // attributes, however, belong to the newest view, not a previous render.
    for(const name of ['disabled','readonly','required','hidden','aria-disabled','aria-invalid','aria-label','aria-describedby','title']){
     if(next.hasAttribute(name)){if(old.getAttribute(name)!==next.getAttribute(name))old.setAttribute(name,next.getAttribute(name));}
     else if(old.hasAttribute(name))old.removeAttribute(name);
    }
    continue;
   }
   for(const attr of [...old.attributes])if(attr.name!=='open'&&!next.hasAttribute(attr.name))old.removeAttribute(attr.name);
   for(const {name,value} of next.attributes)if(name!=='open'&&old.getAttribute(name)!==value)old.setAttribute(name,value);
   sync(old,[...next.childNodes]);
  }
  while(host.childNodes.length>nodes.length)host.lastChild.remove();
 }
 sync(parent,incoming);
}
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') node.className=value;
    else if (key === 'dataset') Object.assign(node.dataset,value);
    else if (key.startsWith('on') && typeof value === 'function') bindEvent(node,key.slice(2).toLowerCase(),value);
    else if (key === 'value') node.value=value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'open') node[key]=!!value;
    else node.setAttribute(key,value===true?'':String(value));
  }
  function append(child) {
    if (Array.isArray(child)) child.forEach(append);
    else if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  children.forEach(append);
  return node;
}
export const button = (label, onClick, kind='secondary') => h('button',{type:'button',class:'fy-button '+kind,onClick},label);
export const empty = (title,description='') => h('div',{class:'fy-empty',role:'status'},h('span',{class:'fy-empty-orbit','aria-hidden':'true'},'◌'),h('strong',{},title),description&&h('p',{},description));
export const section = (title,description,...children) => h('section',{class:'fy-section fy-panel'},h('header',{class:'fy-section-head'},h('div',{},h('h2',{},title),description&&h('p',{},description))),...children);
export const field = (label,input) => h('label',{class:'fy-field'},h('span',{},label),input);
export const formButton = label => h('button',{type:'submit',class:'fy-button primary'},label);
export const format = (value,d=2) => typeof value==='number' && Number.isFinite(value) ? value.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
export const money = value => typeof value==='number' && Number.isFinite(value) ? Math.abs(value)>=1e8?format(value/1e8)+' 亿':Math.abs(value)>=1e4?format(value/1e4)+' 万':format(value) : '—';
export const percent = value => typeof value==='number' && Number.isFinite(value) ? (value>0?'+':'')+format(value)+'%' : '—';
export const direction = value => typeof value==='number'&&Number.isFinite(value)?value>0?'fy-positive':value<0?'fy-negative':'':'';
export function table(columns, rows) {
  const normalized=columns.map(c=>typeof c==='string'?{label:c,value:r=>r?.[c]}:c);
  return h('div',{class:'fy-table-wrap'},h('table',{class:'fy-table'},h('thead',{},h('tr',{},normalized.map(c=>h('th',{scope:'col'},c.label)))),h('tbody',{},rows?.length?rows.map(row=>h('tr',{},normalized.map(c=>h('td',{},typeof c.value==='function'?c.value(row):row?.[c.key]??'—')))):h('tr',{},h('td',{colspan:columns.length},empty('暂无记录','读取成功后会显示服务端的实际结果。'))))));
}
export function tabs(items,active,onPick) {
  return h('div',{class:'fy-tabs',role:'tablist'},items.map(item=>{
    const key=typeof item==='string'?item:item.key??item.id??item.value;
    const label=typeof item==='string'?item:item.label;
    return h('button',{type:'button',role:'tab','aria-selected':String(key===active),class:key===active?'active':'',onClick:()=>onPick(key)},label);
  }));
}
export function safeLink(url,label) {
  try {
    const parsed=new URL(url,location.origin);
    if (!['https:','http:'].includes(parsed.protocol)) return h('span',{},label||'来源链接不可用');
    return h('a',{href:parsed.href,target:'_blank',rel:'noopener noreferrer'},label||parsed.hostname,' ↗');
  } catch { return h('span',{},label||'来源未知'); }
}
export function dateTime(value) {
  if(value==null||value==='')return '日期未知';
  const at=typeof value==='number'?value:Date.parse(value);
  if(!Number.isFinite(at)||at<=0)return '日期未知';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(at);
}
export function dayLabel(value) {
  if(typeof value==='string'&&/^\d{8}$/.test(value)) return value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6);
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'交易日待核验';
}
export const note = (text,tone='') => h('p',{class:'fy-note '+tone,role:'status'},text);
export function displayValue(value) {
  if(value==null)return '未知';
  if(typeof value==='number')return format(value);
  if(typeof value==='boolean')return value?'是':'否';
  if(Array.isArray(value))return value.map(displayValue).join(' · ');
  if(typeof value==='object')return Object.entries(value).filter(([,v])=>v!=null&&typeof v!=='object').slice(0,10).map(([k,v])=>k+'：'+displayValue(v)).join(' · ');
  return String(value);
}
export function downloadJSON(filename,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=h('a',{href:url,download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
export function icon(name,attrs={}) {
  const paths={pulse:'M2 12h5l3-8 4 16 3-8h5',spark:'m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z',lab:'M9 3h6m-5 0v7L4 21h16l-6-11V3M8 15h8',assets:'M3 7h18v14H3V7Zm0 0 14-4v4m-2 6h6v4h-6Z',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l1-2h4l1 2 4 2 2 1v4l-2 1v3l2 1v4l-2 1-4 2-1 2h-4l-1-2-4-2-2-1v-4l2-1v-3l-2-1V6l2-1Z',search:'m21 21-5-5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0Z',bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4',refresh:'M20 7a9 9 0 1 0 1 9M20 2v6h-6',close:'m5 5 14 14M5 19 19 5',arrow:'M4 12h16m-6-6 6 6-6 6',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const[k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'fy-icon',...attrs}))svg.setAttribute(k,v);
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.spark);svg.append(path);return svg;
}
