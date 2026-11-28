import {activeBook,bookHeaders} from './book-session.mjs';

const endpoint='/api/research/shortline';
const foreground=new Set();
const bytes=key=>Uint8Array.from(atob(key.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const encoded=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const deviceId=async url=>encoded(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url))).slice(0,30);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const active=ctx=>ctx.canEdit===true&&!ctx.signal?.aborted;
const today=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
async function regForPage(){
  if(!navigator.serviceWorker)return null;
  const registration=await navigator.serviceWorker.getRegistration('/');
  return registration?.active?registration:null;
}
export function noticeList(notices=[]){
  return notices.length?'<ul>'+notices.slice(0,15).map(n=>'<li><strong>'+escape(n.title)+'</strong><p style="white-space:pre-wrap">'+escape(n.text)+'</p></li>').join('')+'</ul>':'<p>当前账户暂无收盘通知。</p>';
}
export async function enableDevice(ui,ctx,book=activeBook()){
  if(!active(ctx))throw Error('需要研究编辑权限');
  const list=await ui.readView('notices');
  if(!active(ctx))return;
  if(book==='demo'||ui.state?.permissions?.canWrite!==true){
    ui.modal('站内收盘通知','<p>本机订阅请在主实例的正式研究账户中设置。</p>'+noticeList(list.notices),null);return;
  }
  const registration=await regForPage().catch(()=>null);
  const sub=registration?.pushManager?await registration.pushManager.getSubscription():null;
  const currentDeviceId=sub?await deviceId(sub.endpoint):null;
  const on=currentDeviceId&&(list.deviceIds||[]).includes(currentDeviceId);
  if(!active(ctx)||activeBook()!==book)return;
  const receipt=on&&(list.deliveryEvidence||[]).find(r=>r.deviceId===currentDeviceId);
  const deliveryText=receipt?.gatewayStatus==='accepted'?'最近网关已受理；终端接收及已读未确认。':receipt?.gatewayStatus==='rejected'?'最近网关拒绝；终端状态未知。':'尚无可核验的网关受理记录；终端接收及已读未知。';
  const fg=foreground.has(book);
  const body='<p>'+ (on?'本机已启用浏览器后台提醒。':fg?'本页已启用前台提醒。':'启用后浏览器会请求通知权限。系统通知只显示通用提醒，具体内容在登录后查看。')+'</p>'+
    '<p>'+escape(deliveryText)+'</p>'+
    '<label><span>设备通知</span><select name="device"><option value="keep">保持当前设置</option>'+
    (on||fg?'<option value="off">关闭本账户的本机提醒</option>':'<option value="on">在此设备启用</option>')+'</select></label><h3>站内收盘通知</h3>'+noticeList(list.notices);
  ui.modal('本机网页通知',body,async form=>{
    const choice=form.get('device');if(choice==='keep')return;
    if(!active(ctx)||activeBook()!==book)throw Error('设备会话已结束');
    if(choice==='off'){
      if(on)await ui.save('notice:unsubscribe',{endpoint:sub.endpoint});
      foreground.delete(book);
      ui.toast('已关闭本账户的本机提醒');return;
    }
    if(choice!=='on')throw Error('请选择设备通知选项');
    if(!globalThis.Notification||!globalThis.isSecureContext)throw Error('请在支持系统通知的 HTTPS 浏览器中打开；站内通知仍可在此处查阅');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('浏览器未授权通知；站内通知仍可在此处查阅');
    if(!active(ctx)||activeBook()!==book)return;
    if(registration?.pushManager){
      let subscription;
      try{
        const {publicKey}=await ui.save('notice:key',{});
        const current=await registration.pushManager.getSubscription();
        if(current?.options?.applicationServerKey&&encoded(current.options.applicationServerKey)!==publicKey)
          throw Error('设备当前订阅使用不同密钥');
        subscription=current||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(publicKey)});
        if(!active(ctx)||activeBook()!==book)return;
        await ui.save('notice:subscribe',{endpoint:subscription.endpoint});
        foreground.delete(book);ui.toast('本机已启用后台网页通知');return;
      }catch(error){
        if(ctx.signal?.aborted)throw error;
        if(error.name==='NotAllowedError')throw Error('浏览器未允许后台订阅，请检查网站通知权限');
        if(error.status===401||error.status===403)throw error;
      }
    }
    foreground.add(book);ui.toast('已启用本页前台提醒，保持本页登录即可接收');
  });
}
export function startNoticePolling(ctx){
  if(!active(ctx))return ()=>{};
  const since=Date.now(),seen=new Map();let stopped=false,timer=null,running=false;
  const stop=()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);foreground.clear();};
  async function poll(){
    if(stopped||running||!active(ctx))return;
    clearTimeout(timer);running=true;
    try{
      const book=activeBook();if(book==='demo'||document.hidden)return;
      const x=await ctx.api(endpoint,{headers:{...bookHeaders(book),'X-V6-Research-View':'notices'},signal:ctx.signal});
      if(stopped||!active(ctx)||activeBook()!==book)return;
      const entries=(x?.result?.notices||[]).filter(n=>n.day===today()&&n.createdAt>=since&&!n.muted);
      let collected=seen.get(book);if(!collected){collected=new Set();seen.set(book,collected);}
      const fresh=entries.filter(n=>!collected.has(n.id));
      if(!fresh.length)return;
      for(const n of fresh)collected.add(n.id);
      if(collected.size>256)seen.set(book,new Set(entries.map(n=>n.id)));
      ctx.notify?.('研究账户有 '+fresh.length+' 条新提醒，可在网页通知中查看');
      if(foreground.has(book)&&globalThis.Notification?.permission==='granted'){
        const title='绯曜研究提醒',options={body:'登录研究台查看最新复盘与提醒。',tag:'fayo-shortline-research',data:{researchNotice:true}};
        const reg=await regForPage();
        if(!active(ctx)||stopped||activeBook()!==book||!foreground.has(book)||globalThis.Notification?.permission!=='granted')return;
        if(reg)await reg.showNotification(title,options);else new Notification(title,options);
      }
    }catch(error){if(error.status===401||error.status===403)stop();}
    finally{running=false;if(!stopped&&active(ctx))timer=setTimeout(poll,60000);}
  }
  function visible(){if(!document.hidden)void poll();}
  ctx.signal?.addEventListener('abort',stop,{once:true});
  document.addEventListener('visibilitychange',visible);void poll();return stop;
}
