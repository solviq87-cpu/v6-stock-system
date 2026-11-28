import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createHash,createPrivateKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import workspace from '../../core/research-workspace-store.js';
import locks from '../../core/account-process-lock.js';
import files from '../../core/market-data-center.js';
import {settingsAt} from '../../../public/nova/shortline/settings.mjs';
import {buildReview} from '../../../public/nova/shortline/review.mjs';
import {learningSnapshot} from '../../../public/nova/shortline/learning.mjs';

const dayClock=t=>new Date(t+8*3600000).toISOString().slice(0,16);
const minuteOK=t=>/^(?:1[5-9]|2[0-3]):[0-5]\d$/.test(t);
const empty=()=>({notices:[],devices:[],checkedDay:''});
const hash=s=>createHash('sha256').update(s).digest('base64url').slice(0,30);
const b64=data=>Buffer.from(data).toString('base64url');
const problem=message=>new Error(message);
function read(file,fallback){
  let fd;
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));}
  catch(e){if(e.code==='ENOENT')return fallback;throw e;}
  try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.mode&0o077||st.size>2*1024*1024)throw problem('通知档案权限或大小无效');
    return JSON.parse(fs.readFileSync(fd,'utf8'));
  }finally{fs.closeSync(fd);}
}
const write=(f,data)=>files.atomicWrite(f,JSON.stringify(data));
const ledger=dir=>path.join(dir,'research-notices-v1.json');
const schedule=dir=>path.join(dir,'research-notices-schedule.json');
const guarded=(dir,f)=>locks.withAccountLock(path.join(dir,'notice-delivery'),f);
const load=dir=>read(ledger(dir),empty());
function originEndpoint(value){
  if(typeof value!=='string'||value.length<20||value.length>2048)throw problem('设备订阅地址无效');
  let u;try{u=new URL(value);}catch{throw problem('设备订阅地址无效');}
  const h=u.hostname;
  const supported=(h==='fcm.googleapis.com'&&/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:.\-]+$/.test(u.pathname)&&!u.search)||
    (h==='updates.push.services.mozilla.com'&&/^\/wpush\/v[12]\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.search)||
    (h==='web.push.apple.com'&&/^\/[A-Za-z0-9_:/.-]+$/.test(u.pathname)&&!u.search)||
    (/^(?:[a-z0-9-]+\.)?notify\.windows\.com$/.test(h)&&/^\/w\/?$/.test(u.pathname)&&u.searchParams.has('token'));
  if(!supported||u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw problem('当前浏览器推送服务尚未接入，可使用页面内提醒');
  return u.href;
}
function keyFor(root,create){
  const dir=workspace.privateRoot(root,create),file=path.join(dir,'research-vapid-key-v1.json');
  const stored=read(file,null);
  if(stored)return stored;
  if(!create)throw problem('尚未开通设备通知');
  return locks.withAccountLock(path.join(dir,'notice-vapid'),()=>{
    const previous=read(file,null);if(previous)return previous;
    const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const jwk=privateKey.export({format:'jwk'});
    const publicKey=Buffer.concat([Buffer.of(4),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
    const keys={jwk,publicKey};write(file,keys);return keys;
  });
}
export function noticeDeviceAction({root,dir,book,action,payload={},replica}){
  if(replica||!book||book==='demo')throw problem('设备通知仅在主实例正式研究账户中设置');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw problem('设备参数无效');
  if(action==='notice:key'&&!Object.keys(payload).length)return {publicKey:keyFor(root,true).publicKey};
  if(!['notice:subscribe','notice:unsubscribe'].includes(action)||Object.keys(payload).some(k=>k!=='endpoint'))throw problem('通知操作无效');
  const endpoint=originEndpoint(payload.endpoint),id=hash(endpoint);
  if(action==='notice:subscribe')keyFor(root,true);
  const safe=workspace.privateRoot(dir,true);
  return guarded(safe,()=>{
    const data=load(safe),existing=data.devices.find(d=>d.id===id);
    if(action==='notice:unsubscribe')data.devices=data.devices.filter(d=>d.id!==id);
    else if(!existing){
      if(data.devices.length>=8)throw problem('每个研究账户最多启用 8 台通知设备');
      data.devices.push({id,endpoint,enabledAt:Date.now()});
    }
    write(ledger(safe),data);return {enabled:action==='notice:subscribe',devices:data.devices.length};
  });
}
export function noticeView({dir,state,book}){
  if(book==='demo')return {notices:[],devices:0};
  const data=load(workspace.privateRoot(dir)),muted=settingsAt(state).mutedAlertTypes||[];
  const deliveryEvidence=data.devices.map(d=>{
    const r=d.lastGatewayReceipt,valid=r&&typeof r.day==='string'&&Number.isSafeInteger(r.attemptedAt)&&Number.isSafeInteger(r.recordedAt)&&r.attemptedAt<=r.recordedAt&&r.recordedAt<=Date.now()&&r.recordedAt>=d.enabledAt&&r.recordedAt>=(state?.ledgerStartAt||0);
    const code=valid&&Number.isInteger(r.status)&&r.status>=100&&r.status<=599?r.status:null;
    return {deviceId:d.id,day:valid?r.day:null,attemptedAt:valid?r.attemptedAt:null,recordedAt:valid?r.recordedAt:null,
      gatewayStatus:code===null?'unknown':code>=200&&code<300?'accepted':code>=400&&code<500&&code!==408?'rejected':'unknown',
      gatewayStatusCode:code,receiverConfirmed:false,readConfirmed:false};
  });
  return {devices:data.devices.length,deviceIds:data.devices.map(d=>d.id),deliveryEvidence,notices:data.notices.filter(n=>n.createdAt>=(state?.ledgerStartAt||0)).slice(-50).reverse().map(n=>({...n,muted:muted.includes(n.type)}))};
}
export function syncNoticeSchedule({dir,state,book}){
  if(book==='demo')return;
  const safe=workspace.privateRoot(dir,true),time=settingsAt(state).dailyReviewTime||'';
  return guarded(safe,()=>{
    const previous=read(schedule(safe),{});
    if(previous.time===time)return;
    write(schedule(safe),{time,checkedDay:'',retryAt:0});
  });
}
export function resetNoticeArchive({dir}){
  const safe=workspace.privateRoot(dir);
  if(!fs.existsSync(ledger(safe)))return;
  return guarded(safe,()=>{
    const data=load(safe);data.notices=[];data.checkedDay='';
    for(const d of data.devices){delete d.pending;delete d.lastGatewayReceipt;}
    write(ledger(safe),data);
    const prev=read(schedule(safe),null);
    if(prev)write(schedule(safe),{time:prev.time,checkedDay:'',retryAt:0});
  });
}
export function hasDueWebNotices({dir,day,now=Date.now()}){
  if(!Number.isFinite(now)||dayClock(now).slice(0,10)!==day)return false;
  const s=read(schedule(workspace.privateRoot(dir)),null);
  if(!s||!minuteOK(s.time)||dayClock(now).slice(11)<s.time)return false;
  return s.checkedDay!==day||s.retryAt>0&&s.retryAt<=now;
}
function retryMarker(dir,time,data,day){
  const pending=data.devices.map(d=>d.pending).filter(p=>p?.day===day);
  write(schedule(dir),{time,checkedDay:day,retryAt:pending.length?Math.min(...pending.map(p=>Math.max(p.at,p.lease||0))):0});
}
function makeNotices(state,day,now){
  const review=buildReview(state,{date:day,period:'day',depth:'brief',quality:'all',set:'research'});
  const daily={id:'review/'+day,type:'review',day,createdAt:now,title:day+' 收盘复盘',text:review.text.slice(0,1400)};
  const alerts=learningSnapshot(state,{asOf:now}).alerts.slice(0,12).map(a=>({id:a.id,type:'risk',day,createdAt:now,
    title:'因子失效预警',text:a.message+'。'+a.periods.map(p=>p.period+' '+p.n+' 笔，胜率 '+p.winRate+'%，盈亏比 '+p.payoff).join('；')}));
  return [daily,...alerts];
}
export function vapidHeaders(endpoint,keys,topic,now){
  const target=new URL(originEndpoint(endpoint)),subject=process.env.V6_RESEARCH_VAPID_SUBJECT;
  const claims={aud:target.origin,exp:Math.floor(now/1000)+3600};
  if(typeof subject==='string'&&/^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)&&subject.length<=200)claims.sub=subject;
  const unsigned=b64(JSON.stringify({typ:'JWT',alg:'ES256'}))+'.'+b64(JSON.stringify(claims));
  const signature=sign('SHA256',Buffer.from(unsigned),{key:createPrivateKey({key:keys.jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'});
  const midnight=Date.parse(dayClock(now).slice(0,10)+'T00:00:00+08:00')+86400000;
  return {Authorization:'vapid t='+unsigned+'.'+b64(signature)+', k='+keys.publicKey,TTL:String(Math.max(1,Math.min(3600,Math.floor((midnight-now)/1000)))),
    Urgency:'normal',Topic:topic,'Content-Length':'0'};
}
function sendEmptyPush(endpoint,keys,topic,now){
  const target=new URL(originEndpoint(endpoint)),headers=vapidHeaders(endpoint,keys,topic,now);
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{method:'POST',headers},res=>{
      res.resume();const hint=res.headers['retry-after'];
      const retryAt=typeof hint==='string'?(/^\d+$/.test(hint)?now+Number(hint)*1000:Date.parse(hint)):0;
      resolve({status:res.statusCode,retryAt:Number.isFinite(retryAt)?Math.min(now+86400000,retryAt):0});
    });
    const timer=setTimeout(()=>req.destroy(problem('网页推送超时')),4000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
  });
}
export async function tickWebNotices({root,dir,book,state,day,tradingDay,primary,now=Date.now(),isPrimary=()=>primary,isCurrent=()=>true,sendPush=sendEmptyPush}){
  const idle={generated:0,sent:0};
  if(primary!==true||tradingDay!==true||!isPrimary()||!isCurrent()||book==='demo'||state.scope==='demo'||!Number.isFinite(now)||day!==dayClock(now).slice(0,10))return idle;
  const s=settingsAt(state,now),time=s.dailyReviewTime,muted=s.mutedAlertTypes||[];
  if(!minuteOK(time)||dayClock(now).slice(11)<time)return idle;
  const safe=workspace.privateRoot(dir,true),keyfile=ledger(safe);
  const batch=guarded(safe,()=>{
    if(!isPrimary()||!isCurrent())return {generated:0,deliveries:[]};
    const data=load(safe),epoch=state.ledgerStartAt||0;
    if(epoch>(data.epoch||0)){
      data.epoch=epoch;data.notices=data.notices.filter(n=>n.createdAt>=epoch);data.checkedDay='';
      for(const d of data.devices){delete d.pending;delete d.lastGatewayReceipt;}
    }
    const fresh=data.checkedDay===day?[]:makeNotices(state,day,now).filter(n=>!data.notices.some(p=>p.id===n.id));
    data.checkedDay=day;data.notices.push(...fresh);
    data.notices=data.notices.filter(n=>n.createdAt>=now-90*86400000).slice(-240);
    const types=[...new Set(fresh.map(n=>n.type).filter(t=>!muted.includes(t)))];
    for(const d of data.devices){
      if(d.pending?.day!==day)delete d.pending;
      if(types.length)d.pending={day,types,attempts:0,at:now,lease:0};
      if(d.pending?.types.every(t=>muted.includes(t)))delete d.pending;
    }
    // Reserve delivery before network I/O. Expired leases recover after a crash.
    const deliveries=data.devices.filter(d=>d.pending?.at<=now&&(d.pending.lease||0)<=now).slice(0,2);
    for(const d of deliveries){d.pending.lease=now+90000;d.pending.token=randomUUID();}
    if(!isPrimary()||!isCurrent())return {generated:0,deliveries:[]};
    write(keyfile,data);retryMarker(safe,time,data,day);
    return {generated:fresh.length,deliveries:deliveries.map(d=>({id:d.id,endpoint:d.endpoint,token:d.pending.token}))};
  });
  let sent=0;
  await Promise.all(batch.deliveries.map(async task=>{
    let status=0,retryAt=0;
    try{
      // Recheck role and subscription immediately before dispatch.
      if(!isPrimary()||!isCurrent()||!load(safe).devices.some(d=>d.id===task.id&&d.pending?.token===task.token))return;
      const res=await sendPush(task.endpoint,keyFor(root,false),hash(book+'/'+day),now);
      status=typeof res==='number'?res:res?.status;if(!Number.isInteger(status)||status<100||status>599)status=0;retryAt=Number.isFinite(res?.retryAt)?res.retryAt:0;
    }catch{status=0;}
    guarded(safe,()=>{
      if(!isPrimary()||!isCurrent())return;
      const data=load(safe),device=data.devices.find(d=>d.id===task.id);
      if(device?.pending?.token!==task.token)return;
      // This is the gateway's response to an empty push, not evidence of a
      // device receipt or a user's reading. Never resurrect revoked devices.
      device.lastGatewayReceipt={day,attemptedAt:now,recordedAt:Date.now(),status:Number.isInteger(status)&&status>=100&&status<=599?status:null};
      if(status>=200&&status<300){delete device.pending;sent++;}
      else if([404,410].includes(status))data.devices=data.devices.filter(d=>d.id!==task.id);
      else{
        const p=device.pending;p.attempts++;
        if(p.attempts>=5)delete device.pending;
        else{p.at=Math.max(retryAt,now+Math.min(3600000,60000*2**(p.attempts-1)));delete p.token;delete p.lease;}
      }
      write(keyfile,data);retryMarker(safe,time,data,day);
    });
  }));
  return {generated:batch.generated,sent};
}
