const MARKET_FIELDS=['dashboard','pool','global','external','sectors','auction','ztPool','ztPre','trendScan','steadyUp','trendPool','smallyang','mainline','buzhang','pre','myrules','nextplan','signals'];
const populated=value=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:value!=null;
export function retainMarket(previous,incoming) {
  if(!incoming||typeof incoming!=='object')throw Error('服务端没有返回可用状态');
  if(incoming.needAuth||incoming.needPassword||incoming.invalid||incoming.ok===false||(incoming.locked&&incoming.readOnly!==true)||(previous?.role&&incoming.role&&previous.role!==incoming.role))return incoming;
  if(!previous||!(incoming.trading===false||incoming.isSnapshot===true||incoming.dashboard?.isSnapshot===true))return incoming;
  const next={...incoming};
  // Server-owned review rows and their source metadata must never be restored independently.
  const keepFieldDay=(key,day='')=>{const fields=previous.snapshotFieldDays||{};next.snapshotFieldDays={...next.snapshotFieldDays,[key]:Object.hasOwn(fields,key)?fields[key]:day};};
  for(const key of MARKET_FIELDS)if(!populated(next[key])&&populated(previous[key])){
    next[key]=previous[key];keepFieldDay(key,key==='dashboard'?previous.dashboard.snapshotDay||previous.snapshotDay||'':'');
  }
  // Relay rows are private. A server permission projection must clear them;
  // only an empty, still-authorized closed-session read may recover old rows.
  const relayDenied=incoming.role==='view'||incoming.readOnly===true||incoming.paper?.hidden===true||incoming.yier?.hidden===true||incoming.lianban?.hidden===true;
  if(!relayDenied)for(const [key,dayKey]of [['yierList','yierAsOf'],['lianbanList','lianbanAsOf']]){
    if((!Array.isArray(next[key])||!next[key].length)&&Array.isArray(previous[key])&&previous[key].length){
      next[key]=previous[key];next[dayKey]=previous[dayKey]||'';keepFieldDay(key);
      if(previous[dayKey])next.snapshotFieldDays[key]=previous[dayKey];
    }
  }
  // An empty pool object still has metadata keys. Preserve the entire prior
  // result so its rows, counts and source dates cannot describe different runs.
  if(!incoming.abMove?.items?.length&&previous.abMove?.items?.length){next.abMove=previous.abMove;keepFieldDay('abMove');}
  if(incoming.dashboard&&previous.dashboard) {
    const dashboard={...incoming.dashboard};
    for(const key of ['rows','indices','strategies','counts','mood','pushes'])if(!populated(dashboard[key])&&populated(previous.dashboard[key]))dashboard[key]=previous.dashboard[key];
    if(!Array.isArray(incoming.dashboard.rows)||!incoming.dashboard.rows.length){
      if(previous.dashboard.rows?.length){dashboard.counts=previous.dashboard.counts;dashboard.strategies=previous.dashboard.strategies;dashboard.snapshotDay=previous.dashboard.snapshotDay||previous.snapshotDay;dashboard.snapshotRetained=true;dashboard.isSnapshot=true;keepFieldDay('dashboard',dashboard.snapshotDay||'');}
    }
    next.dashboard=dashboard;
  }
  return next;
}
export class ApiError extends Error { constructor(message,status=0,body=null){super(message);this.name='ApiError';this.status=status;this.body=body;} }
// Five-second cadence reads only the existing authenticated cloud snapshot.
// It does not call a market provider, trade or refresh the original quote time.
export function createSnapshotPoller({read,signal,page=document,network=globalThis.window,delay=()=>5000,setInterval:repeat=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval}) {
 let timer=null,busy=false,stopped=false,cadence=0;
 const visible=()=>page.visibilityState==='visible'&&network?.navigator?.onLine!==false;
 const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
 function schedule(){
  if(stopped||signal?.aborted||!visible()){clear();return;}
  const ms=Math.max(1000,Math.min(2147483647,delay()));
  if(timer!==null&&cadence===ms)return;
  clear();cadence=ms;timer=repeat(run,ms);
 }
 async function tick(){
  if(stopped||signal?.aborted||!visible()||busy)return;
  busy=true;try{await read();}finally{busy=false;schedule();}
 }
 const run=()=>{void tick().catch(()=>{});};
 function visibility(){clear();if(stopped||signal?.aborted||!visible())return;schedule();run();}
 function stop(){stopped=true;clear();page.removeEventListener('visibilitychange',visibility);network?.removeEventListener('online',visibility);network?.removeEventListener('offline',clear);signal?.removeEventListener('abort',stop);}
 if(signal?.aborted)return stop;
 page.addEventListener('visibilitychange',visibility);signal?.addEventListener('abort',stop,{once:true});
 network?.addEventListener('online',visibility);network?.addEventListener('offline',clear);schedule();
 return stop;
}

export function getSession(){try{return localStorage.getItem('qd_device')||localStorage.getItem('qd_token')||'';}catch{return '';}}
export function saveSession(token,role){try{localStorage.removeItem('qd_token');if(token)localStorage.setItem('qd_device',token);else localStorage.removeItem('qd_device');if(role)localStorage.setItem('qd_role',role);else localStorage.removeItem('qd_role');}catch{}}
export function deviceId(){try{let id=localStorage.getItem('fayo.device');if(!id){id=crypto.randomUUID();localStorage.setItem('fayo.device',id);}return id;}catch{return 'fayo-'+Math.random().toString(36).slice(2);}}
export function createClient({onUnauthorized=()=>{},getToken=getSession}={}) {
  let generation=0;
  const pending=new Set();
  function invalidate(){generation++;for(const controller of pending)controller.abort();pending.clear();}
  async function api(path,options={}) {
    const url=new URL(path,location.origin);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/assets/'))throw new ApiError('只允许读取当前服务的接口');
    if([...url.searchParams.keys()].some(key=>/token|password|sharecode|secret/i.test(key)))throw new ApiError('凭据不能出现在链接中');
    const token=getToken();
    if(token&&(typeof token!=='string'||!/^[A-Za-z0-9._~-]{8,256}$/.test(token))){invalidate();onUnauthorized();throw new ApiError('访问授权格式无效，请重新登录',401);}
    const headers={'Accept':'application/json',...options.headers};
    // A caller cannot retain another identity in either authentication header.
    for(const key of Object.keys(headers))if(/^(?:authorization|x-qd-token)$/i.test(key))delete headers[key];
    if(token){headers.Authorization='Bearer '+token;headers['X-QD-Token']=token;}
    const controller=new AbortController(),turn=generation;
    pending.add(controller);
    const timeout=setTimeout(()=>controller.abort(new DOMException('请求超时','TimeoutError')),options.timeoutMs??(options.method&&options.method.toUpperCase()!=='GET'?60000:15000));
    if(options.signal){if(options.signal.aborted)controller.abort();else options.signal.addEventListener('abort',()=>controller.abort(),{once:true});}
    const method=(options.method||'GET').toUpperCase();
    if(options.body!==undefined)headers['Content-Type']='application/json';
    try {
      const response=await fetch(url,{method,headers,cache:'no-store',credentials:'same-origin',signal:controller.signal,...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
      let data;try{data=await response.json();}catch{throw new ApiError('服务暂未返回有效数据，请稍后重试',response.status);}
      if(turn!==generation)throw new DOMException('身份已更新','AbortError');
      if(response.status===401||(data?.locked&&data?.readOnly!==true)||data?.needAuth||data?.needPassword||data?.invalid) {
        invalidate();onUnauthorized();throw new ApiError(data.message||data.error||'访问授权已失效，请重新登录',response.status||401,data);
      }
      if(!response.ok||data?.ok===false)throw new ApiError(data.error||data.message||data.note||'操作未完成',response.status,data);
      return data;
    } finally {clearTimeout(timeout);pending.delete(controller);}
  }
  return {api,invalidate};
}
