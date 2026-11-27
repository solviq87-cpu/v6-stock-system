'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {privateRoot}=require('../core/research-workspace-store');
const {atomicWrite}=require('../core/market-data-center');

const stockCode=/^\d{6}$/, shard=/^(?:stock-\d{6}|sector-BK\d{4})-(?:1|5)m$/;
const positive=n=>Number.isFinite(n)&&n>0;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>new Error('分钟档案格式或来源完整性异常');
function validDay(day){
  if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day))return false;
  const ms=Date.parse(day+'T12:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().startsWith(day);
}
function cnTime(text){
  if(typeof text!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(text))return NaN;
  return Date.parse(text.replace(' ','T')+':00+08:00');
}
function folder(root,day,create){
  if(!validDay(day))throw invalid();
  return privateRoot(path.join(privateRoot(root,create),'minutes-v1',day),create);
}
function read(file){
  let fd;
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||stat.size>1024*1024)throw invalid();
    const envelope=JSON.parse(gunzipSync(fs.readFileSync(fd),{maxOutputLength:2*1024*1024}));
    if(envelope?.v!==1||envelope.sha256!==digest(JSON.stringify(envelope.data)))throw invalid();
    return envelope.data;
  }finally{fs.closeSync(fd);}
}
function write(file,data){
  atomicWrite(file,gzipSync(JSON.stringify({v:1,sha256:digest(JSON.stringify(data)),data})));
}
// End-of-bar timestamps, not the opening auction or lunch interval.
function minuteEnd(date,day,period){
  if(typeof date!=='string'||!date.startsWith(day+' ')||!['1m','5m'].includes(period)||!validDay(day))return NaN;
  const at=cnTime(date),m=Number(date.slice(11,13))*60+Number(date.slice(14,16)),step=period==='5m'?5:1;
  const origin=m>570&&m<=690?570:m>780&&m<=900?780:null;
  return Number.isSafeInteger(at)&&origin!==null&&(m-origin)%step===0&&date.slice(11,13)<='23'&&date.slice(14,16)<='59'?at:NaN;
}
function validateBar(b,day,key){
  if(!b||typeof b!=='object')throw invalid();
  const at=minuteEnd(b.date,day,b.period),available=cnTime(b.availableAt);
  if(!shard.test(key)||key!==b.role+'-'+b.code+'-'+b.period||!b.date.startsWith(day+' ')||
      !Number.isSafeInteger(at)||!Number.isSafeInteger(b.knownAt)||b.knownAt<at||
      !Number.isSafeInteger(available)||available> b.knownAt||b.knownAt-available>=60000||
      available<Date.parse(day+'T15:00:00+08:00')||
      (b.priceBasis!=null&&b.priceBasis!=='unadjusted')||
      (b.role==='stock'&&b.volumeUnit!=null&&b.volumeUnit!=='shares')||
      (b.secid!=null&&b.secid!==(b.role==='sector'?'90.':b.code.startsWith('6')?'1.':'0.')+b.code)||
      ![b.open,b.high,b.low,b.close].every(positive)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||
      !Number.isSafeInteger(b.volume)||b.volume<0||(b.amount!=null&&(!Number.isFinite(b.amount)||b.amount<0))||
      typeof b.source!=='string'||!b.source.startsWith('V6/'))throw invalid();
}
function linksFor(dir,day,code){
  const data=read(path.join(dir,'links-'+code+'.json.gz'));
  if(data===null)return {};
  if(data.day!==day||data.code!==code||!data.links||typeof data.links!=='object'||Array.isArray(data.links))throw invalid();
  for(const [key,at] of Object.entries(data.links)){
    if(!shard.test(key)||key.startsWith('stock-')&&!key.startsWith('stock-'+code+'-')||!Number.isSafeInteger(at)||at<1)throw invalid();
  }
  return data.links;
}
function shardFor(dir,day,key,required=false){
  const data=read(path.join(dir,key+'.json.gz'));
  if(!data&&!required)return {rows:[]};
  if(!data||data.day!==day||data.key!==key||!Array.isArray(data.rows)||data.rows.length>512)throw invalid();
  for(const b of data.rows)validateBar(b,day,key);
  if(data.rows.some((b,i)=>i>0&&data.rows[i-1].date>=b.date))throw invalid();
  if(data.turnoverAudit){
    const {completeAt,disputedAt}=data.turnoverAudit;
    if(!key.startsWith('stock-')||[completeAt,disputedAt].some(at=>at!==null&&(!Number.isSafeInteger(at)||at<1)))throw invalid();
  }
  return data;
}

// A V6 sync holds the existing account-process lock across all shard writes.
// Share sector files between stocks; per-stock links are published last. A
// retry after interruption reuses any already-verified rows without appending.
function saveMinuteBars(root,{day,code,observedAtMs},rows){
  if(!stockCode.test(code)||!validDay(day)||!Number.isSafeInteger(observedAtMs)||!Array.isArray(rows)||rows.length>2048)throw invalid();
  const result={added:0,confirmed:0,conflicts:0};
  if(!rows.length)return result;
  const groups=new Map();
  for(const b of rows){
    if(!b||typeof b!=='object')throw invalid();
    const key=b.role+'-'+b.code+'-'+b.period;
    validateBar(b,day,key);
    if(b.role==='stock'&&b.code!==code||b.knownAt>observedAtMs)throw invalid();
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(b);
  }
  // Validate incoming duplicate identities before publishing any shards.
  for(const group of groups.values()){
    const seen=new Map();
    for(const b of group){
      const prior=seen.get(b.date);
      if(prior&&['open','high','low','close','volume','amount','amountUnit','priceBasis','volumeUnit','secid'].some(k=>prior[k]!==b[k]))throw invalid();
      if(!prior)seen.set(b.date,b);
    }
  }
  const dir=folder(root,day,true),links=linksFor(dir,day,code);
  let newLinks=false;
  for(const [key,incoming] of groups){
    const stored=shardFor(dir,day,key),byMinute=new Map(stored.rows.map(b=>[b.date,b]));
    // Earlier shards did not retain dispute times. Keep them readable for their
    // original purpose, without retrospectively certifying a turnover baseline.
    const audit=stored.turnoverAudit||(!stored.rows.length&&key.startsWith('stock-')?{completeAt:null,disputedAt:null}:null);
    let changed=false;
    for(const bar of incoming){
      const prior=byMinute.get(bar.date);
      if(!prior){byMinute.set(bar.date,bar);result.added++;changed=true;continue;}
      const conflict=['open','high','low','close','volume','amount','priceBasis','volumeUnit','secid'].some(k=>
        prior[k]!=null&&bar[k]!=null&&prior[k]!==bar[k])||
        audit&&bar.amount!=null&&bar.amountUnit!=null&&bar.amountUnit!==(prior.amountUnit??'CNY');
      if(conflict){
        result.conflicts++;
        if(audit&&(audit.disputedAt===null||observedAtMs<audit.disputedAt)){
          audit.disputedAt=observedAtMs;changed=true;
        }
      }
      else result.confirmed++;
    }
    if(byMinute.size>512)throw invalid();
    if(audit&&audit.completeAt===null&&byMinute.size===(key.endsWith('-1m')?240:48)){
      audit.completeAt=observedAtMs;changed=true;
    }
    if(changed)write(path.join(dir,key+'.json.gz'),{day,key,...(audit?{turnoverAudit:audit}:{}),rows:[...byMinute.values()].sort((a,b)=>a.date.localeCompare(b.date))});
    if(!Object.hasOwn(links,key)){
      // Sector membership is observed for this particular stock at this sync.
      links[key]=observedAtMs;newLinks=true;
    }
  }
  if(newLinks)write(path.join(dir,'links-'+code+'.json.gz'),{day,code,links});
  return result;
}

function readMinuteBars(root,{day,code,observedAtMs}={}){
  if(!stockCode.test(code)||!validDay(day)||!Number.isSafeInteger(observedAtMs))return [];
  const dir=folder(root,day,false),links=linksFor(dir,day,code),out=[];
  for(const [key,linkedAt] of Object.entries(links)){
    if(linkedAt>observedAtMs)continue;
    for(const row of shardFor(dir,day,key,true).rows){
      if(row.knownAt>observedAtMs)continue;
      out.push(key.startsWith('sector-')?{...row,membershipKnownAt:linkedAt}:row);
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||a.role.localeCompare(b.role)||a.period.localeCompare(b.period));
}
// Only the selected stock and native period are read. A different stock's
// archive, including any linked industry files, cannot complete a sample.
function readTurnoverSession(root,{day,code,period,observedAtMs}){
  if(!stockCode.test(code)||!validDay(day)||!['1m','5m'].includes(period)||!Number.isSafeInteger(observedAtMs))return {status:'invalid-selection'};
  const dir=folder(root,day,false),key='stock-'+code+'-'+period;
  const linkedAt=linksFor(dir,day,code)[key];
  if(linkedAt===undefined||linkedAt>observedAtMs)return {status:'missing-session'};
  const {rows,turnoverAudit:audit}=shardFor(dir,day,key,true);
  if(!audit)return {status:'legacy-without-dispute-history'};
  if(audit.disputedAt!==null&&audit.disputedAt<=observedAtMs)return {status:'disputed-session'};
  if(!audit.completeAt||audit.completeAt>observedAtMs||rows.length!==(period==='1m'?240:48))return {status:'incomplete-session'};
  if(rows.some(row=>row.knownAt>observedAtMs))return {status:'not-yet-observed'};
  return {status:'available',rows,capturedAt:audit.completeAt};
}
module.exports={saveMinuteBars,readMinuteBars,readTurnoverSession,minuteEnd};
