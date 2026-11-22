// Historical features use bars at or before the observation. Forward labels are
// calculated separately and are never inputs to detection or similarity ranking.
import {inferEvidence} from './recognize.mjs';
import { emotion, marketAsOf, validate } from './market.mjs';

const HORIZONS = [1, 2, 3, 5, 10];
const DIMENSIONS = ['shape', 'volume', 'turnover', 'indexTrend', 'themeCycle'];
const DIM_NAMES = ['K线形态', '量能', '换手', '全A趋势', '题材周期'];
const MISSING = '缺失';
const allTime = '9999-12-31';
const mean = a => a.length ? a.reduce((n, v) => n + v, 0) / a.length : null;
const pct = (x, y) => (x / y - 1) * 100;
const rounded = n => Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
const display = (n, unit = '%') => Number.isFinite(n) ? n.toFixed(2) + unit : '—';
const stamp = s => s.length === 10 ? s + ' 15:00' : s;
const cutoff = s => s.length === 10 ? s + ' 23:59' : s;
const uniq = a => [...new Set(a.filter(Boolean))];
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const truth = x => ['1','true','是','有'].includes(String(x).trim().toLowerCase());
const split = s => String(s || '').split(/[|；;、]/).map(v=>v.trim()).filter(Boolean);
const esc = x => String(x ?? '').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const datePattern = /^\d{4}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d)?$/;
const validDate = s => {
  if (!datePattern.test(s)) return false;
  const d = new Date(s.slice(0,10)+'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0,10) === s.slice(0,10);
};
const barKey = b => [b.role||'stock', b.code, b.period || (b.date.length>10?'分时':'日K'), b.date].join('/');
const label = (s,n) => s && s !== MISSING ? n+s : '';
const isBlack = v => v === true || Boolean(v && !['0','false','否','无'].includes(String(v).trim().toLowerCase()));
const HEADER = {日期:'date',时间:'date',代码:'code',标的代码:'code',名称:'name',标的名称:'name',开盘:'open',开盘价:'open',最高:'high',最高价:'high',最低:'low',最低价:'low',收盘:'close',收盘价:'close',成交量:'volume',成交额:'amount',换手率:'turnover',全A趋势:'indexTrend',题材:'sector',题材周期:'themeCycle',黑天鹅:'blackSwan',周期:'period',数据类型:'role',可用时间:'availableAt'};
export function parseKCsv(csv) {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).byteLength > 2*1024*1024) throw Error('每次导入上限为 2 MiB');
  csv=csv.replace(/^\uFEFF/,'');
  let fields=[], value='', quote=false, rows=[];
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"'){
      if(quote && csv[i+1]==='"'){value+='"';i++;} else quote=!quote;
    } else if(c===',' && !quote){fields.push(value.trim());value='';}
    else if((c==='\r' || c==='\n') && !quote){
      if(c==='\r' && csv[i+1]==='\n')i++;
      fields.push(value.trim());if(fields.some(Boolean)) rows.push(fields);fields=[];value='';
    } else value+=c;
  }
  if(quote)throw Error('CSV 引号未闭合');
  fields.push(value.trim());if(fields.some(Boolean))rows.push(fields);
  if(rows.length<2 || rows.length>20001)throw Error('每次需要导入 1 至 20,000 根 K 线');
  const headers=rows.shift().map(k=>HEADER[k]||k);
  if(new Set(headers).size!==headers.length)throw Error('表头列名重复');
  for(const k of ['date','code','open','high','low','close','volume'])if(!headers.includes(k))throw Error('缺少列 '+k);
  return rows.map((r,i)=>{
    const fail=msg=>{throw Error('第 '+(i+2)+' 行：'+msg);};
    if(r.length!==headers.length)fail('列数与表头不一致');
    const p=Object.fromEntries(headers.map((k,i)=>[k,r[i]]));
    const role=({个股:'stock',全A:'index',板块:'sector'})[p.role]||p.role||'stock';
    if(!['stock','index','sector'].includes(role))fail('role 只接受 stock、index、sector');
    if(!validDate(p.date) || (p.availableAt && (!validDate(p.availableAt)||stamp(p.availableAt)<stamp(p.date))))fail('日期或数据可用时间无效');
    if((p.name||'').length>60 || (p.period||'').length>20)fail('名称或周期字段过长');
    if(!p.code || p.code.length>48 || (role==='stock'&&!/^\d{6}$/.test(p.code)))fail('个股代码需为六位数字');
    let b={role,date:p.date,code:p.code,name:p.name||p.code,period:p.period||(p.date.length>10?'分时':'日K'),availableAt:p.availableAt||p.date};
    for(const k of ['open','high','low','close','volume','amount','turnover','lockedRatio','sectorAssists','themeAge','chipPeak','limitUp','limitDown','streak','sealRatio','auctionRatio','auctionAmount','sectorAuctionUpPct','floatCap','listingDays','unlockPct30d','sectorBreakPct']){
      if(p[k]==null || p[k]===''){if(['open','high','low','close','volume'].includes(k))fail(k+' 缺值');continue;}
      const n=Number(String(p[k]).replace(/%$/,''));
      if(!Number.isFinite(n)||n<0||(['open','close','low','high'].includes(k)&&n===0))fail(k+' 数值无效');
      b[k]=n;
    }
    for(const k of ['auctionGap','auctionNetBuy','first15mChange','last30mChange','netActiveBuy']){
      if(p[k]!=null&&p[k]!==''){const n=Number(p[k]);if(!Number.isFinite(n))fail(k+' 数值无效');b[k]=n}
    }
    if(b.high<Math.max(b.open,b.low,b.close)||b.low>Math.min(b.open,b.close)||b.turnover>100||b.lockedRatio>100)fail('价格或百分比范围异常');
    for(const k of ['indexTrend','sector','themeCycle','indexVolume','breadth','resonance','indexLevel','ladder','sectorLeader','blackSwan','risks','selected','events','quality','chipExchange','indexCode','announcementType','regulationStatus','newsStatus','sessionOpen','sessionClose']){
      if(p[k]){if(p[k].length>800)fail('字段过长');b[k]=p[k];}
    }
    return b;
  });
}

export function backtestAction(state,action,payload={}){
  if(action==='k:import'){
    const incoming=parseKCsv(payload.csv);
    const allowed=new Set((state.catalog||[]).flatMap(c=>c.factors.map((_,i)=>c.id+':'+i)));
    for(const b of incoming)if(split(b.selected).some(x=>!allowed.has(x)))throw Error('包含未知因子编号：'+b.code+' '+b.date);
    const existing=new Map((state.bars||[]).map(b=>[barKey(b),b]));
    let count=0;
    for(const b of incoming){
      const id=barKey(b), prev=existing.get(id);
      if(prev){
        if(Object.keys({...prev,...b}).some(k=>prev[k]!==b[k]))throw Error('同一时点数据冲突：'+b.code+' '+b.date+'；原始行情已保留');
      } else {existing.set(id,b);count++;}
    }
    if(existing.size>50000)throw Error('当前研究库上限为 50,000 根 K 线');
    state.bars=[...existing.values()];
    return {count,duplicates:incoming.length-count};
  }
  if(action==='k:correct'){
    const b=(state.bars||[]).find(b=>barKey(b)===payload.id && (!b.role||b.role==='stock'));
    if(!b)throw Error('找不到原始 K 线');
    const strategy=String(payload.strategy||'').trim(), reason=String(payload.reason||'').trim();
    if(!reason || reason.length>500 || strategy.length>60)throw Error('请填写 1–500 字修正依据');
    if(!['撤销信号','更正信号','补记信号'].includes(payload.mode))throw Error('修正类型无效');
    if(payload.mode!=='撤销信号' && !strategy)throw Error('请选择更正后的战法');
    // The server assigns knowledge time. Retroactive annotations cannot appear
    // in an earlier as-of query or in the causal training view.
    const now=new Date(Date.now()+8*36e5).toISOString().slice(0,16).replace('T',' ');
    if(strategy && ![...(state.catalog||[]).filter(c=>c.kind==='strategy').map(c=>c.name),'放量突破观察','缩量回踩观察','低位承接观察','放量加速观察','高位兑现观察'].includes(strategy))throw Error('请选择已定义的战法或技术形态');
    const entry={id:payload.id,mode:payload.mode,strategy,reason,recordedAt:now};
    (state.corrections||=[]).push(entry);return entry;
  }
  throw Error('未知 K 线操作');
}

function groups(bars){
  const map=new Map();
  for(const b of bars){
    const key=[b.role||'stock',b.code,b.period||(b.date.length>10?'分时':'日K')].join('/');
    if(!map.has(key))map.set(key,[]);map.get(key).push(b);
  }
  for(const arr of map.values())arr.sort((a,b)=>compare(a.date,b.date));
  return map;
}
function extract(b,history,ctx){
  history=history.slice(-20);
  const prev=history.at(-1), closes=history.map(v=>v.close), prices=[...closes,b.close];
  const ma=n=>prices.length>=n ? mean(prices.slice(-n)) : null;
  const ma5=ma(5), ma10=ma(10), ma20=ma(20);
  const range=b.high-b.low, body=b.close-b.open, change=prev ? pct(b.close,prev.close):null;
  const prevVol=history.length>=5?mean(history.slice(-5).map(x=>x.volume)):null;
  const vr=prevVol>0?b.volume/prevVol:null;
  const turn=b.turnover == null?MISSING:b.turnover<2?'低换手':b.turnover>20?'巨量换手':'健康换手';
  const shape=prev && b.low>prev.high?'跳空高开':prev && b.high<prev.low?'跳空低开':!range||Math.abs(body)<=range*.1?'十字星':b.high-Math.max(b.open,b.close)>range*.55?'长上影':Math.min(b.open,b.close)-b.low>range*.55?'长下影':Math.abs(pct(b.close,b.open))>=3?(body>0?'大阳线':'大阴线'):(body>=0?'小阳线':'小阴线');
  const max20=history.length>=20?Math.max(...history.map(x=>x.high)):null, min20=history.length>=20?Math.min(...history.map(x=>x.low)):null;
  const zone = max20!=null && max20!==min20?(b.close-min20)/(max20-min20):null;
  const structure=max20==null?MISSING:b.close>max20?'突破':b.close<min20?'破位':ma10 && b.low<=ma10*1.01 && b.close>=ma10?'回踩':max20/min20<1.12?'横盘箱体':'区间整理';
  const volume=vr==null?MISSING:vr>=2.5?'爆量':vr>=1.3?'放量':vr<=.75?'缩量':'平量';
  const vseq=history.slice(-2).concat(b).map(i=>i.volume);
  return {shape,position:zone==null?MISSING:zone<.33?'低位':zone>.67?'高位':'中位',volume,turnover:turn,indexTrend:b.indexTrend||ctx.indexTrend||MISSING,themeCycle:b.themeCycle||ctx.themeCycle||MISSING,maState:ma20==null?MISSING:ma5>ma10&&ma10>ma20?'多头排列':ma5<ma10&&ma10<ma20?'空头排列':'缠绕震荡',ma5,ma10,ma20,
    d5:ma5?rounded(pct(b.close,ma5)):null,d10:ma10?rounded(pct(b.close,ma10)):null,d20:ma20?rounded(pct(b.close,ma20)):null,
    structure,ratio:rounded(vr),change:rounded(change),relation:prev?'价'+(b.close>=prev.close?'涨':'跌')+'量'+(b.volume>=prev.volume?'增':'缩'):MISSING,
    volumeRun:vseq.length<3?MISSING:vseq[0]<vseq[1]&&vseq[1]<vseq[2]?'持续放量':vseq[0]>vseq[1]&&vseq[1]>vseq[2]?'持续缩量':'交替',
    indexVolume:b.indexVolume||ctx.indexVolume||MISSING,breadth:b.breadth||ctx.breadth||MISSING,resonance:b.resonance||ctx.resonance||MISSING,indexLevel:b.indexLevel||ctx.indexLevel||MISSING,
    sectorAssists:b.sectorAssists??ctx.sectorAssists??null,themeAge:b.themeAge??ctx.themeAge??null,ladder:b.ladder||ctx.ladder||MISSING,sectorLeader:b.sectorLeader||ctx.sectorLeader||MISSING,
    chipPeak:b.chipPeak??null,lockedRatio:b.lockedRatio??null,chipExchange:b.chipExchange||MISSING};
}
function classify(f,b,catalog,ids=new Set(split(b.selected))){
  const matched=ids.size?catalog.filter(c=>c.kind==='strategy'&&c.factors.length&&c.factors.every((_,i)=>ids.has(c.id+':'+i))).map(c=>c.name):[];
  if(matched.length)return {strategy:matched[0],strategies:matched,type:'确认信号'};
  // These are partial technical setups, never full discretionary strategy matches.
  let setup='',type='试错信号';
  if(f.structure==='突破'&&f.ratio>=1.3){setup='放量突破观察';type='确认信号';}
  else if(f.structure==='回踩' && f.maState==='多头排列' && f.volume==='缩量')setup='缩量回踩观察';
  else if(f.shape==='长下影' && f.position==='低位' && f.ratio>=1)setup='低位承接观察';
  else if(f.shape==='大阳线' && f.ratio>=2 && f.maState==='多头排列'){setup='放量加速观察';type='加速信号';}
  else if(f.shape==='长上影' && f.position==='高位' && f.ratio>=1.5){setup='高位兑现观察';type='兑现信号';}
  return {strategy:setup,strategies:setup?[setup]:[],type};
}
function dailyGroups(series){
  const sessions=[], indices=new Map();
  for(const b of series){
    const day=b.date.slice(0,10);
    let s=sessions.at(-1);
    if(s?.day!==day){s={day,open:b.open,close:b.close,high:b.high,low:b.low,events:new Set(),available:stamp(b.availableAt||b.date),black:false};indices.set(day,sessions.length);sessions.push(s);}
    s.fullOpen ??= b.date.length===10 || truth(b.sessionOpen) || ['09:30','09:31'].includes(b.date.slice(11));
    s.fullClose ||= b.date.length===10 || truth(b.sessionClose) || b.date.endsWith('15:00');
    s.limitUp=b.limitUp ?? s.limitUp;s.limitDown=b.limitDown ?? s.limitDown;
    s.close=b.close;s.high=Math.max(s.high,b.high);s.low=Math.min(s.low,b.low);
    s.black ||= isBlack(b.blackSwan);s.available=[s.available,stamp(b.availableAt||b.date)].sort().at(-1);
    split(b.events).forEach(e=>s.events.add(e));

  }
  sessions.forEach((today,i)=>{
    const yesterday=sessions[i-1],prior=sessions[i-2];
    if(today.limitUp>0 && today.close===today.limitUp)today.events.add('封板');
    if(today.limitUp>0 && today.high===today.limitUp && today.close<today.limitUp)today.events.add('炸板');
    if(yesterday?.limitUp>0 && yesterday.close===yesterday.limitUp && today.limitUp>0 && today.close<today.limitUp)today.events.add('断板');
    if(prior?.limitUp>0 && prior.close===prior.limitUp && yesterday.events.has('断板') && today.events.has('封板') && today.close>yesterday.high)today.events.add('反包');
    if(yesterday?.limitUp>0 && yesterday.close===yesterday.limitUp && today.limitDown>0 && today.open===today.limitDown && today.close===today.limitDown)today.events.add('核按钮');
  });
  return {sessions,indices};
}
function labels(days,b,until,decisionAt=stamp(b.date)){
  const i=days.indices.get(b.date.slice(0,10)), result={};
  for(const h of HORIZONS){
    const segment=days.sessions.slice(i+1,i+h+1), first=segment[0],last=segment.at(-1);
    // End-of-day labels are unavailable during an incomplete intraday session.
    if(segment.length!==h || first.day+' 09:30'<=decisionAt || stamp(last.day)>until || segment.some(s=>s.available>until || !s.fullClose) || !first.fullOpen || first.high===first.low){
      result[h]=null;continue;
    }
    result[h]={close:rounded(pct(last.close,first.open)),high:rounded(pct(Math.max(...segment.map(x=>x.high)),first.open)),low:rounded(pct(Math.min(...segment.map(x=>x.low)),first.open)),
      end:last.day, availableAt:[stamp(last.day),...segment.map(s=>s.available)].sort().at(-1),events:uniq(segment.flatMap(x=>[...x.events])),blackSwan:segment.some(s=>s.black)};
  }
  return result;
}
function contextMaps(state,by){
  const indices=new Map(),sectors=new Map(),market=new Map(),versions=[...(state.marketHistory||[]),...(state.market||[])];
  for(const day of versions){
    if(!market.has(day.date))market.set(day.date,[]);market.get(day.date).push(day);
  }
  for(const series of by.values()){
    if(!['sector','index'].includes(series[0].role))continue;
    for(let i=0;i<series.length;i++){
      const b=series[i],point=stamp(b.date), period=b.period||'日K';
      if(stamp(b.availableAt||b.date)>point)continue;
      const prior=series.slice(Math.max(0,i-20),i).filter(x=>stamp(x.availableAt||x.date)<=point);
      const f=extract(b,prior,{});
      const info={...b,change:f.change,derivedMA:f.maState};
      if(b.role==='index'){
        if(!b.indexTrend && f.ma20!=null)info.indexTrend=f.maState==='多头排列'?'多头':f.maState==='空头排列'?'空头':'震荡';
        if(!b.indexVolume && f.ratio!=null && f.change!=null)info.indexVolume=(f.ratio>=1.3?'放量':f.ratio<=.75?'缩量':'平量')+(f.change>=0?'上涨':'下跌');
        const k=period+'/'+b.date;
        if(!indices.has(k))indices.set(k,[]);indices.get(k).push(info);
      }else sectors.set([b.sector||b.code,period,b.date].join('/'),info);
    }
  }
  return {indices,sectors,market,versions};
}
function observations(state,asOf,options={}){
  const until=cutoff(asOf), raw=(state.bars||[]).filter(b=>stamp(b.date)<=until), by=groups(raw), context=contextMaps(state,by), result=[];
  const archived=new Map(),stages=new Map();
  for(const check of state.checks||[]){
    if(!check.capture||!check.createdAt||!check.matches?.length)continue;
    const registered=new Date(check.createdAt).getTime();
    if(!Number.isFinite(registered))continue;
    const registeredAt=new Date(registered+8*3600000).toISOString().slice(0,16).replace('T',' ');
    const time=[registeredAt,check.asOf].sort().at(-1);
    const key=check.code+'/'+check.date;
    if(time<=until&&(!archived.has(key)||archived.get(key).time>time))archived.set(key,{check,time});
  }
  const edits=new Map();
  for(const c of state.corrections||[])if(c.recordedAt<=until)edits.set(c.id,c);
  for(const series of by.values()){
    if(series[0].role && series[0].role!=='stock')continue;
    const days=dailyGroups(series);
    for(let i=0;i<series.length;i++){
      const b=series[i], point=stamp(b.date);
      const frozen=b.date.length===10&&archived.get(b.code+'/'+b.date);
      if(frozen){
        const {check,time}=frozen;
        const type=check.position>0?'确认信号':'受限观察';
        result.push({id:barKey(b),date:b.date,decisionAt:time,code:b.code,name:check.name,period:b.period,sector:check.theme||MISSING,
          features:check.capture.features,context:check.capture.context,strategy:check.matches[0],strategies:check.matches,type,originalStrategy:check.matches[0],originalType:type,
          risks:check.risks,gate:{status:check.status,position:check.position,eligible:check.eligible},blackSwan:isBlack(b.blackSwan),quality:b.quality||'标准样本',outcomes:labels(days,b,until,time),edit:null});
        continue;
      }
      if(stamp(b.availableAt||b.date)>point)continue;
      const day=b.date.slice(0,10),period=b.period||'日K';
      const market=marketAsOf({market:context.market.get(day)||[]},day,point).at(-1)||{};
      const indices=context.indices.get(period+'/'+b.date)||[];
      const index=indices.find(x=>x.code===b.indexCode)||(indices.length===1?indices[0]:{});
      const sector=context.sectors.get([b.sector||'',period,b.date].join('/'))||{};
      const ctx={indexTrend:index.indexTrend||market.trend,indexVolume:index.indexVolume||market.volume,indexLevel:index.indexLevel||market.indexPosition,breadth:market.breadth||index.breadth,...sector};
      if(!ctx.resonance && Number.isFinite(index.change) && Number.isFinite(sector.change)){
        if(index.change>0 && sector.change>0)ctx.resonance='题材指数共振';
        if(index.change<0 && sector.change>0)ctx.resonance='题材独立背离';
      }
      const history=series.slice(Math.max(0,i-60),i).filter(x=>stamp(x.availableAt||x.date)<=point);
      const features=extract(b,history,ctx);
      if(!stages.has(point))stages.set(point,emotion(marketAsOf({market:context.versions},day,point),day,point).stage);
      const stage=stages.get(point);
      const inferred=inferEvidence(b,history,features,market,stage,sector,state.catalog||[]);
      const keys=new Set([...inferred.facts].filter(([,v])=>v.pass).map(([k])=>k));
      // Historical CSV annotations are retained as explicit supplied evidence.
      for(const k of split(b.selected))keys.add(k);
      let {strategy,strategies,type}=classify(features,b,state.catalog||[],keys);
      const complete=(state.catalog||[]).some(c=>c.kind==='strategy'&&c.name===strategy);
      const originalStrategy=strategy, originalType=type;
      const id=barKey(b), edit=edits.get(id);
      let gate=null;
      if(strategy && complete && b.date.length>10){gate={status:'盘中仅观察，收盘后校验',position:0,eligible:[],risks:['日线盘面尚未确认']};}
      if(strategy && complete && b.date.length===10){
        const trades=(state.trades||[]).filter(t=>!t.createdAt||new Date(Date.parse(t.createdAt)+8*36e5).toISOString().slice(0,16).replace('T',' ')<=point);
        gate=validate({...state,trades},{date:day,code:b.code,name:b.name,selected:[...keys],theme:b.sector||'',mainline:inferred.main,strongSector:inferred.strong},{skipPrediction:true});
      }
      if(gate && (gate.position<=0 || !gate.eligible?.length))type='受限观察';
      if(edit && (!options.causal || edit.recordedAt<=point)){
        strategy=edit.mode==='撤销信号'?'':edit.strategy;strategies=strategy?[strategy]:[];type='人工标注';
      }
      if(!strategy && !options.all)continue;
      const risks=[...split(b.risks),...(gate?.risks||[])];
      if(b.selected){
        const ids=new Set(split(b.selected));
        for(const c of state.catalog||[])if(c.kind==='avoid'&&c.factors.some((_,j)=>ids.has(c.id+':'+j)))risks.push(c.name);
      }
      if(features.turnover==='巨量换手')risks.push('换手异常');
      if(features.themeCycle==='退潮')risks.push('题材退潮');
      const isX=isBlack(b.blackSwan)||b.quality==='不可复制';
      result.push({id,date:b.date,code:b.code,name:b.name,period:b.period,sector:b.sector||MISSING,strategy,strategies,type,originalStrategy,originalType,features,context:{indexClose:index.close??null,indexChange:index.change??null,sectorClose:sector.close??null,sectorChange:sector.change??null},gate:gate?{status:gate.status,position:gate.position,eligible:gate.eligible}:null,risks:uniq(risks),blackSwan:isX,quality:isX?'隔离样本':'标准样本',outcomes:labels(days,b,until),edit:edit && (!options.causal||edit.recordedAt<=point)?edit:null});
    }
  }
  return result.sort((a,b)=>compare(b.date,a.date)||compare(a.code,b.code));
}
export function deriveCheckInput(state,input){
 const code=String(input.code||''),date=String(input.date||'');
 if(!/^\d{6}$/.test(code)||!validDate(date)||date.length!==10)throw Error('请选择六位标的代码和有效交易日');
 const obs=state.v6Observation||{},current=obs.code===code&&obs.day===date;
 const wall=String(obs.observedAt||'').replace('T',' ').slice(0,16);
 const asOf=current&&obs.latestClosed===true&&validDate(wall)&&wall>=stamp(date)?wall:stamp(date);
 const raw=(state.bars||[]).filter(b=>b.date.length===10&&b.date<=date&&stamp(b.availableAt||b.date)<=asOf);
 const stocks=raw.filter(b=>(!b.role||b.role==='stock')&&b.code===code).sort((a,b)=>compare(a.date,b.date));
 const history=stocks.filter(b=>b.date<date).slice(-60),bar=stocks.find(b=>b.date===date);
 const marketRows=marketAsOf(state,date,asOf),market=marketRows.find(r=>r.date===date)||{},stage=emotion(marketRows,date,asOf).stage;
 const stock=current&&obs.latestClosed&&wall<=asOf&&obs.stock?.code===code?obs.stock:{};
 const b={...bar,date,code,name:bar?.name||stock.name||code};
 for(const [key,value] of Object.entries({close:stock.price,turnover:stock.turnover,sector:stock.theme||stock.sector,amount:stock.amount,sectorAssists:stock.sectorAssists,sectorLeader:stock.sectorLeader,ladder:stock.ladder,resonance:stock.resonance,limitUp:stock.limitUp,streak:stock.consecutiveLimits,sealRatio:stock.sealRatio})){
  if(value!=null&&b[key]==null)b[key]=value;
 }
 const sectorRows=raw.filter(r=>r.role==='sector'&&b.sector&&(r.sector||r.code)===b.sector).sort((a,b)=>compare(a.date,b.date));
 const sector=sectorRows.at(-1)?.date===date?{...sectorRows.at(-1)}:{};
 if(sector.close&&sectorRows.length>=2)sector.change=pct(sector.close,sectorRows.at(-2).close);
 if(Number.isFinite(stock.sectorChange))sector.change=stock.sectorChange;
 const f=extract(b,history.slice(-20),{...sector,indexTrend:market.trend,themeCycle:sector.themeCycle});
 const {facts,main,strong}=inferEvidence(b,history,f,market,stage,sector,state.catalog);
 // Derived upstream only from the trusted V6 close snapshot, never the submitted check request.
 for(const key of stock.selected||[]){if(!facts.has(key))facts.set(key,{pass:true,source:'V6 同期收盘池与梯队记录'})}
 const selected=[...facts].filter(([,fact])=>fact.pass).map(([k])=>k);
 const candidates=[],evidence=[],missing=[];
 for(const item of state.catalog){
  const gaps=[],failed=[],hits=[];
  item.factors.forEach((name,i)=>{const fact=facts.get(item.id+':'+i);
   if(!fact)gaps.push(name);else if(!fact.pass)failed.push(name);else{hits.push(name);evidence.push(item.name+' · '+name+'：'+fact.source)}
  });
  if(item.kind==='strategy'&&hits.length)candidates.push({name:item.name,matched:hits.length,total:item.factors.length,missing:gaps,failed});
 }
 candidates.sort((a,b)=>Number(a.failed.length>0)-Number(b.failed.length>0)||b.matched/b.total-a.matched/a.total);
 if(!bar)missing.push('当日可见的完整日 K');if(history.length<20)missing.push('至少 20 根之前的日 K');
 if(!knownFeature(b.sector))missing.push('标的所属题材');if(!market.date)missing.push('同日市场收盘快照');
 if(!selected.length)missing.push('足以识别战法的盘面证据');
 return {code,date,name:b.name,theme:b.sector||'',selected,mainline:stock.mainline??main,strongSector:stock.strongSector??strong,asOf,
 capture:current&&obs.latestClosed===true&&bar?{features:f,context:{sectorChange:sector.change??null,indexChange:market.indexChange??null}}:null,
 recognition:{evidence:[...new Set([...(current?obs.evidence||[]:[]),...evidence])],missing:[...new Set([...missing,...(current&&Array.isArray(obs.missing)?obs.missing:[])])],candidates:candidates.slice(0,8)}};
}
function knownFeature(v){return v!=null&&v!==''&&v!==MISSING}

export function signals(state,asOf=allTime){return observations(state,asOf,{causal:true});}
function causalFactors(s){
  const f=s.features;
  return uniq([s.strategy,label(f.shape,'形态·'),label(f.volume,'量能·'),label(f.turnover,'换手·'),label(f.indexTrend,'指数·'),label(f.themeCycle,'周期·'),label(f.resonance,'共振·'),...s.risks]);
}
export function kLearningRows(state,asOf=allTime){
  return observations(state,asOf,{causal:true}).filter(s=>s.outcomes[5] && !s.blackSwan && !s.outcomes[5].blackSwan && !['兑现信号','受限观察'].includes(s.type)).map(s=>({id:s.id,date:s.date.slice(0,10),exitDate:s.outcomes[5].availableAt.slice(0,10),code:s.code,name:s.name,strategy:s.strategy,pnl:s.outcomes[5].close,factors:causalFactors(s),indexTrend:s.features.indexTrend,environment:s.features.indexTrend,blackSwan:false}));
}
function distribution(values){
  const a=values.filter(Number.isFinite).sort((a,b)=>a-b);
  function q(p){if(!a.length)return null;const n=p*(a.length-1),x=Math.floor(n);return rounded(a[x]+(a[Math.ceil(n)]-a[x])*(n-x));}
  const gain=mean(a.filter(x=>x>0)),loss=mean(a.filter(x=>x<0));
  return {n:a.length,ratio:gain && loss?rounded(gain/Math.abs(loss)):null,winRate:a.length?rounded(100*a.filter(x=>x>0).length/a.length):null,mean:rounded(mean(a)),min:q(0),p25:q(.25),median:q(.5),p75:q(.75),max:q(1)};
}
export function similarCases(state,target,asOf=target.date){
  if(!target?.date||!validDate(target.date)||!validDate(asOf))throw Error('相似检索需要有效的观测时点');
  const point=target.decisionAt||stamp(target.date);
  if(point>cutoff(asOf))throw Error('查询信号晚于观察截止时点');
  const missing=DIMENSIONS.flatMap((k,i)=>!target.features?.[k] || target.features[k]===MISSING?[DIM_NAMES[i]]:[]);
  const candidates=missing.length?[]:observations(state,point,{causal:true}).filter(s=>s.id!==target.id&&(s.decisionAt||stamp(s.date))<point && !s.blackSwan && DIMENSIONS.every(k=>s.features[k]!==MISSING)).map(s=>({...s,similarity:DIMENSIONS.filter(k=>s.features[k]===target.features[k]).length/5})).filter(s=>s.similarity>=.6).sort((a,b)=>b.similarity-a.similarity||compare(b.date,a.date));
  const distributions=Object.fromEntries([1,3,5,10].map(h=>[h,distribution(candidates.map(s=>s.outcomes[h]?.close))]));
  const mature=candidates.filter(s=>s.outcomes[5]!=null);
  return {success:mature.filter(s=>s.outcomes[5].close>0),failure:mature.filter(s=>s.outcomes[5].close<0),neutral:mature.filter(s=>s.outcomes[5].close===0),distributions,missing};
}

export function equityStats(rows,horizon=5){
  let funds=1,peak=1,drawdown=0,free='',n=0;
  for(const row of [...rows].sort((a,b)=>compare(a.date,b.date)||compare(a.code,b.code))){
    const outcome=row.outcomes[horizon];
    if(!outcome || row.date.slice(0,10)<free)continue;
    funds*=1+outcome.close/100;peak=Math.max(peak,funds);
    drawdown=Math.min(drawdown,pct(funds,peak));free=outcome.end;n++;
  }
  return {n,drawdown:n?rounded(drawdown):null,totalReturn:n?rounded(pct(funds,1)):null};
}
function factorReport(rows){
  const groups=new Map();
  for(const r of rows){
    const f=causalFactors(r), keys=[...f,r.strategy+' / '+r.features.indexTrend,r.features.shape+' / '+r.features.resonance,[r.features.shape,r.features.volume,r.features.indexTrend,r.features.themeCycle].join(' / ')];
    for(let i=0;i<f.length;i++)for(let j=i+1;j<f.length;j++)keys.push(f[i]+' / '+f[j]);
    for(const key of uniq(keys)){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  }
  return [...groups].map(([key,list])=>{
    const values=list.map(s=>s.outcomes[5].close),d=distribution(values);
    const win=mean(values.filter(x=>x>0)),loss=mean(values.filter(x=>x<0));
    return {key,...d,ratio:loss && win?Math.abs(win/loss):null,deepLoss:values.filter(x=>x<=-5).length/values.length*100,worst:Math.min(...list.map(x=>x.outcomes[5].low)),distinct:new Set(list.map(x=>x.date.slice(0,10))).size};
  }).sort((a,b)=>b.n-a.n || b.mean-a.mean);
}
function csvCell(v){
  let s=String(v??'');
  if(/^[=+@\t\r]/.test(s)||(/^[-]/.test(s)&&!Number.isFinite(Number(s))))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
function candleChart(bars,selected,marks){
  const rows=bars.slice(-56),w=940,h=222,l=53,r=12,t=14,base=145,vbase=194;
  if(!rows.length)return '<p class="k-empty">当前范围内无可显示的 K 线。</p>';
  const lo=Math.min(...rows.map(x=>x.low)),hi=Math.max(...rows.map(x=>x.high)),dv=hi-lo||1;
  const y=v=>t+(hi-v)/dv*(base-t),step=(w-l-r)/rows.length, bw=Math.max(2,Math.min(10,step*.64)),sv=Math.max(1,...rows.map(x=>x.volume));
  let g='';
  for(let i=0;i<=4;i++){const price=hi-dv*i/4;g+='<line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(price)+'" y2="'+y(price)+'" stroke="#e6e9f1" stroke-dasharray="3 4"/><text x="2" y="'+(y(price)+4)+'">'+price.toFixed(2)+'</text>';}
  rows.forEach((b,i)=>{
    const x=l+(i+.5)*step,col=b.close>=b.open?'#e45f70':'#269f89';
    if(barKey(b)===selected)g+='<rect x="'+(x-step*.5)+'" y="4" width="'+step+'" height="'+(vbase-4)+'" fill="#7a65db" opacity=".13"/>';
    g+='<g role="button" tabindex="0" aria-label="'+esc(b.date+' '+b.name+' 收盘 '+b.close)+'" data-kbar="'+esc(barKey(b))+'"><title>'+esc(b.date+' 开 '+b.open+' 高 '+b.high+' 低 '+b.low+' 收 '+b.close)+'</title><rect x="'+(x-step*.5)+'" y="2" width="'+step+'" height="'+vbase+'" fill="transparent"/><path d="M'+x+' '+y(b.high)+'V'+y(b.low)+'" stroke="'+col+'" stroke-width="1.5"/><rect x="'+(x-bw/2)+'" y="'+Math.min(y(b.open),y(b.close))+'" width="'+bw+'" height="'+Math.max(1.5,Math.abs(y(b.open)-y(b.close)))+'" fill="'+col+'"/><rect x="'+(x-bw/2)+'" y="'+(vbase-32*b.volume/sv)+'" width="'+bw+'" height="'+(32*b.volume/sv)+'" fill="'+col+'" opacity=".55"/>';
    if(marks.has(barKey(b)))g+='<circle cx="'+x+'" cy="'+(y(b.low)+5)+'" r="2.7" fill="#705cd6"/>';
    g+='</g>';
    if(i===0||i===rows.length-1|| (i%Math.max(10,Math.round(rows.length/4))===0 && rows.length-i>5))g+='<text x="'+x+'" y="215" text-anchor="'+(i===0?'start':i===rows.length-1?'end':'middle')+'">'+esc(b.date.slice(5,10))+'</text>';
  });
  return '<svg class="k-candle" viewBox="0 0 '+w+' '+h+'" aria-label="历史蜡烛图与成交量">'+g+'</svg>';
}
function distTable(dist){
  return '<div class="table-wrap"><table><thead><tr><th>观察窗口</th><th>成熟样本</th><th>胜率</th><th>盈亏比</th><th>最低</th><th>P25</th><th>中位数</th><th>P75</th><th>最高</th></tr></thead><tbody>'+Object.entries(dist).map(([h,d])=>'<tr><td>T + '+h+'</td><td>'+d.n+'</td>'+['winRate','ratio','min','p25','median','p75','max'].map(k=>'<td>'+display(d[k],k==='ratio'?'':'%')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const views=new WeakMap();
const initialView={asOf:'',symbol:'',period:'',tab:'signals',id:'',quality:'all',page:0,search:'',factorMode:'样本覆盖'};
function metric(title,value,note){return '<div class="k-metric"><span>'+title+'</span><strong>'+value+'</strong><small>'+note+'</small></div>';}
function opts(values,picked){return values.map(s=>'<option '+(s===picked?'selected ':'')+'value="'+esc(s)+'">'+esc(s)+'</option>').join('');}
const uiCSS='<style>.kdesk{display:grid;gap:16px;color:var(--text,#28273a)}.kdesk .panel{padding:20px}.k-head,.k-filters,.k-chartfoot,.k-head-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.k-head{justify-content:space-between}.k-head h3,.kdesk h4{margin:0}.k-head h3{font-size:17px}.kdesk .sub,.k-note,.k-empty,.k-chartfoot{color:#707483;font-size:13px}.k-empty{padding:18px 0}.k-note{line-height:1.65;margin:.5rem 0}.k-filters{padding-top:14px}.k-filters label{font-size:13px;color:#656573;display:flex;align-items:center;gap:7px}.kdesk select,.kdesk input{min-height:34px;border-radius:7px;border:1px solid #dcdeeb;background:white;color:#343447;padding:5px 8px}.k-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.k-metric{padding:14px 16px;border:1px solid #e6e5ee;border-radius:9px;background:#fff;display:grid;gap:5px}.k-metric span,.k-metric small{color:#747585;font-size:13px}.k-metric strong{font-size:26px;letter-spacing:-.05em;font-variant-numeric:tabular-nums}.k-candle{width:100%;height:auto;min-height:150px;display:block;margin-top:12px}.k-candle text{fill:#777787;font-size:12px;font-family:inherit}.k-candle g[role]{cursor:pointer}.k-chartfoot{justify-content:space-between}.k-tabs{display:flex;gap:16px;overflow-x:auto;border-bottom:1px solid #e6e6ef;margin-bottom:12px}.k-tabs button,.k-link{appearance:none;border:0;background:none;cursor:pointer;color:#6a657a;font:inherit;font-size:14px;white-space:nowrap}.k-tabs button{padding:0 2px 10px;border-bottom:2px solid transparent}.k-tabs button.active{color:#6b55d1;border-color:#7059df;font-weight:600}.k-link{color:#6752c6;text-decoration:underline;text-underline-offset:3px}.kdesk .table-wrap{overflow-x:auto}.kdesk table{width:100%;border-collapse:collapse;font-size:13px}.kdesk td,.kdesk th{text-align:left;padding:10px 8px;border-bottom:1px solid #f0eef6;white-space:nowrap}.kdesk th{color:#77798a;font-weight:500;background:#f8f8fc}.kdesk .k-chosen{background:#f5f2ff}.k-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}.k-detail-grid div{padding:10px;background:#f7f7fb;border-radius:6px}.k-detail-grid small{display:block;color:#737487;margin-bottom:4px}.k-detail-grid b{font-size:14px}.k-case{font-size:13px;line-height:1.7;border-bottom:1px solid #ececf3;padding:7px 0}.kdesk .tag{display:inline-block}.k-page{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:10px}.k-up{color:#cc4e64}.k-down{color:#16866f}@media(max-width:720px){.k-metrics{grid-template-columns:repeat(2,1fr)}.kdesk .panel{padding:14px}.k-head h3{font-size:16px}.k-chartfoot{font-size:12px}}</style>';
export function renderBacktest(ui){
  const {state,root}=ui;
  if(!views.has(ui))views.set(ui,{...initialView,symbol:ui.stock||'',asOf:ui.date||''});
  const v=views.get(ui);
  const raw=(state.bars||[]).filter(b=>!b.role||b.role==='stock');
  const last=raw.reduce((d,b)=>b.date>d?b.date:d,'').slice(0,10);
  const asOf=v.asOf||last||new Date().toISOString().slice(0,10);
  const observed=state.v6Observation;
  const displayCut=observed?.latestClosed&&observed.day===asOf?observed.observedAt:cutoff(asOf);
  const included=raw.filter(b=>stamp(b.date)<=cutoff(asOf) && stamp(b.availableAt||b.date)<=displayCut);
  const names=new Map(included.map(b=>[b.code,b.name]));
  const symbol=names.has(v.symbol)?v.symbol:[...names.keys()].sort()[0]||'';
  const periods=uniq(included.filter(b=>b.code===symbol).map(b=>b.period||'日K'));
  const period=periods.includes(v.period)?v.period:periods[0]||'日K';
  const bars=included.filter(b=>b.code===symbol && (b.period||'日K')===period).sort((a,b)=>compare(a.date,b.date));
  const all=observations(state,asOf,{all:true});
  const signalsForSymbol=all.filter(s=>s.strategy && s.code===symbol && (s.period||'日K')===period);
  const list=signalsForSymbol.filter(s=> (v.quality==='all'||(v.quality==='standard'?!s.blackSwan:s.blackSwan)) && (!v.search || (s.name+s.code+s.strategy+s.date+s.sector).includes(v.search)));
  const selected=all.find(s=>s.id===v.id && s.code===symbol && (s.period||'日K')===period)||list[0]||all.find(s=>s.code===symbol && (s.period||'日K')===period);
  // Retrospective annotations remain visible in the journal. Official metrics and
  // report membership are reconstructed without those edits to avoid selection bias.
  const pointRows=signals(state,asOf).filter(s=>s.code===symbol && (s.period||'日K')===period && (v.quality==='all'||(v.quality==='standard'?!s.blackSwan:s.blackSwan)) && (!v.search || (s.name+s.code+s.strategy+s.date+s.sector).includes(v.search)));
  const matured=pointRows.filter(s=>s.outcomes[5] && !['兑现信号','受限观察'].includes(s.type));
  const learn=matured.filter(s=>!s.blackSwan && !s.outcomes[5].blackSwan);
  const ds=distribution(matured.map(s=>s.outcomes[5].close)),equity=equityStats(matured);
  const page=Math.min(v.page,Math.max(0,Math.ceil(list.length/10)-1));
  const on=(q,event,cb)=>root.querySelector(q)?.addEventListener(event,cb);
  const redraw=()=>renderBacktest(ui);
  const details=selected?detailPane(state,selected):'<p class="k-empty">导入行情后可查看信号快照。</p>';
  let body='';
  if(v.tab==='signals'){
    body='<div class="k-filters"><label>样本集<select id="kQuality"><option value="all">全部样本</option><option value="standard" '+(v.quality==='standard'?'selected':'')+'>标准样本</option><option value="outlier" '+(v.quality==='outlier'?'selected':'')+'>黑天鹅隔离区</option></select></label><input id="kSearch" aria-label="检索信号" placeholder="搜索战法、日期或题材" value="'+esc(v.search)+'"></div><div class="table-wrap"><table><thead><tr><th>信号日期</th><th>战法 / 技术形态</th><th>信号类型</th><th>全A趋势</th><th>题材周期</th><th>5日收盘收益</th><th>标注</th></tr></thead><tbody>'+list.slice(page*10,page*10+10).map(s=>'<tr class="'+(s.id===selected?.id?'k-chosen':'')+'"><td><button class="k-link" data-krow="'+esc(s.id)+'">'+esc(s.date)+'</button></td><td>'+esc(s.strategy)+'</td><td>'+esc(s.type)+'</td><td>'+esc(s.features.indexTrend)+'</td><td>'+esc(s.features.themeCycle)+'</td><td>'+display(s.outcomes[5]?.close)+'</td><td>'+esc(s.blackSwan?'黑天鹅':s.edit?'人工修正':'自动')+'</td></tr>').join('')+'</tbody></table></div>'+(list.length?'':'<p class="k-empty">该筛选下尚无信号。</p>')+'<div class="k-page"><button id="kPrevious" class="btn" '+(page===0?'disabled':'')+'>上一页</button><span class="sub">'+(page+1)+' / '+Math.max(1,Math.ceil(list.length/10))+'</span><button id="kNext" class="btn" '+((page+1)*10>=list.length?'disabled':'')+'>下一页</button></div>';
  }else if(v.tab==='distribution'){
    body=distTable(Object.fromEntries(HORIZONS.map(h=>[h,distribution(pointRows.filter(s=>!['兑现信号','受限观察'].includes(s.type)).map(s=>s.outcomes[h]?.close))])))+'<p class="k-note">从信号后首个有行情交易日的开盘价计量毛收益。首日全天同价、观察窗口未成熟的样本不计入该窗口。统计基于信号当时可用的标注，保留持有期间突发冲击的收益。因子训练另行剔除不可复制事件。五日最大已结算回撤沿非重叠交易的平仓净值计算。</p>';
  }else if(v.tab==='factors'){
    let factors=factorReport(learn);
    if(v.factorMode==='高风险组合')factors.sort((a,b)=>b.deepLoss-a.deepLoss || b.n-a.n);
    if(v.factorMode==='条件边界')factors=factors.filter(f=>f.n>=20&&f.distinct>=10&&f.mean>0&&f.winRate>=60).sort((a,b)=>b.mean-a.mean);
    body='<div class="k-filters"><label>排序<select id="kFactorMode">'+opts(['样本覆盖','高风险组合','条件边界'],v.factorMode)+'</select></label></div><div class="table-wrap"><table><thead><tr><th>因子 / 组合</th><th>样本</th><th>胜率</th><th>平均收益</th><th>盈亏比</th><th>亏损 ≥5%</th><th>最深不利波动</th></tr></thead><tbody>'+factors.slice(0,40).map(f=>'<tr><td>'+esc(f.key)+'</td><td>'+f.n+'</td><td>'+display(f.winRate)+'</td><td>'+display(f.mean)+'</td><td>'+display(f.ratio,'')+'</td><td>'+display(f.deepLoss)+'</td><td>'+display(f.worst)+'</td></tr>').join('')+'</tbody></table></div><p class="k-note">'+(factors.length?'展示当前筛选的前 '+Math.min(factors.length,40)+' 项。':'此范围内暂无可报告组合。')+' 条件边界要求至少 20 条成熟样本、10 个独立日期、正均值及 60% 胜率，仅作待验证候选。</p>';
  }else if(v.tab==='similar' && selected){
    const result=similarCases(state,selected);
    const side=(title,rows)=>'<div><h4>'+title+' · '+rows.length+'</h4>'+(rows.slice(0,8).map(r=>'<div class="k-case"><button class="k-link" data-kcase="'+esc(r.id)+'">'+esc(r.date+' '+r.name)+'</button> · '+esc(r.sector)+'<br>'+esc(r.strategy)+' · 匹配 '+Math.round(r.similarity*5)+'/5 · 5日 '+display(r.outcomes[5].close)+'</div>').join('')||'<p class="k-empty">没有已成熟的同类案例。</p>')+'</div>';
    body='<p class="k-note">以 '+esc(selected.date+' '+selected.name)+' 为查询时点。五项特征需完整，至少三项相同。结果按相似度、日期排序，五日收益用于成功与失败分栏。</p>'+(result.missing.length?'<p>缺失 '+esc(result.missing.join('、'))+'</p>':'')+'<div class="grid2">'+side('成功案例',result.success)+side('失败案例',result.failure)+'</div>'+distTable(result.distributions);
  }else body='<p class="k-empty">请选择一个信号或导入历史 K 线。</p>';
  const chartBars=bars.filter(b=>!selected || b.date<=selected.date);
  root.innerHTML=uiCSS+'<div class="kdesk"><div class="panel"><div class="k-head"><div><h3>历史行情研究库</h3><div class="sub">'+included.length+' 根 K 线 · '+names.size+' 只标的</div></div><div class="k-head-actions"><a class="btn" href="/nova/shortline/sample-kline.csv" download>示例 CSV</a><button class="btn" id="kExport">导出报告</button><button class="btn primary" id="kImport">导入 K 线</button></div></div><div class="k-filters"><label>观察截止<input type="date" id="kDate" value="'+esc(asOf)+'"></label><label>研究标的<select id="kSymbol">'+[...names].sort().map(([c,n])=>'<option value="'+esc(c)+'" '+(symbol===c?'selected':'')+'>'+esc(n+' · '+c)+'</option>').join('')+'</select></label><label>周期<select id="kPeriod">'+opts(periods,period)+'</select></label></div></div><div class="k-metrics">'+metric('历史信号',list.length,'筛选后含人工标注')+metric('五日胜率',display(ds.winRate),'成熟可观察样本 '+ds.n+' 条')+metric('五日收益中位数',display(ds.median),'次交易日开盘为基准')+metric('最大已结算回撤',display(equity.drawdown),'五日持有 · 非重叠 '+equity.n+' 笔')+'</div><div class="panel"><div class="k-head"><h3>'+esc(names.get(symbol)||'行情走势')+' <span class="sub">'+esc(symbol+' · '+period)+'</span></h3><span class="sub">'+esc(chartBars.at(-1)?.date||'待导入')+'</span></div>'+candleChart(chartBars,selected?.id,new Set(signalsForSymbol.map(s=>s.id)))+'<div class="k-chartfoot"><span>紫点为信号日 · 下图为成交量</span><span>回看日期 <select id="kSnapshot" aria-label="回看K线日期">'+bars.slice().reverse().map(b=>'<option value="'+esc(barKey(b))+'" '+(barKey(b)===selected?.id?'selected':'')+'>'+esc(b.date)+'</option>').join('')+'</select></span></div></div><div class="panel"><div class="k-tabs">'+[['signals','信号记录'],['distribution','收益分布'],['factors','因子分析'],['similar','相似案例']].map(([id,s])=>'<button data-ktab="'+id+'" class="'+(v.tab===id?'active':'')+'">'+s+'</button>').join('')+'</div>'+body+'</div><div class="panel"><div class="k-head"><h3>信号时点快照</h3><button id="kCorrection" class="btn" '+(!selected?'disabled':'')+'>修正标注</button></div>'+details+'</div></div>';
  on('#kSnapshot','change',e=>{v.id=e.target.value;redraw();});
  on('#kDate','change',e=>{if(e.target.value){v.asOf=e.target.value;v.page=0;v.id='';redraw();}});
  for(const [q,key] of [['#kSymbol','symbol'],['#kPeriod','period'],['#kQuality','quality'],['#kFactorMode','factorMode']])on(q,'change',e=>{v[key]=e.target.value;v.page=0;v.id='';redraw();});
  on('#kSearch','change',e=>{v.search=e.target.value.trim();v.page=0;redraw();});
  on('#kPrevious','click',()=>{v.page=page-1;redraw();});on('#kNext','click',()=>{v.page=page+1;redraw();});
  for(const el of root.querySelectorAll('[data-ktab]'))el.addEventListener('click',()=>{v.tab=el.dataset.ktab;redraw();});
  for(const el of root.querySelectorAll('[data-kbar],[data-krow]')){
    const choose=()=>{v.id=el.dataset.kbar||el.dataset.krow;redraw();};
    el.addEventListener('click',choose);
    el.addEventListener('keydown',e=>{if(el.dataset.kbar && ['Enter',' '].includes(e.key)){e.preventDefault();choose();}});
  }
  for(const button of root.querySelectorAll('[data-kcase]')){
    button.addEventListener('click',()=>{
      const peer=all.find(s=>s.id===button.dataset.kcase);
      if(!peer)return;
      v.id=peer.id;v.symbol=peer.code;v.period=peer.period||'日K';v.tab='signals';v.page=0;v.search='';
      redraw();
    });
  }
  on('#kImport','click',()=>ui.modal('导入历史 K 线','<label class="field">CSV 文件<input type="file" accept=".csv,text/csv" name="csv" required></label><p class="k-note">UTF-8 编码，每次最多 2 MiB。必填 date、code、open、high、low、close、volume。价格使用当日原始口径。日线日期或分钟结束时间均为北京时间。</p><details><summary>同期数据与标签字段</summary><p class="k-note">可选 amount、turnover、indexTrend、sector、themeCycle、indexVolume、indexLevel、breadth、resonance、sectorAssists、themeAge、ladder、sectorLeader、chipPeak、lockedRatio、chipExchange、risks、blackSwan、selected、events。selected 填目录编号:因子索引，多个值用 | 分隔。events 可记录封板、断板、反包、二波、核按钮。缺失数据保持空白。</p><p class="k-note">role=index / sector 可导入同期指数、板块记录。按相同结束时间对齐，sector 与个股题材相同。availableAt 可记录晚于收盘的实际可用时间。分时周期用 period 区分。默认以 09:30/09:31 和 15:00 确认交易日首末K线，其他周期可用 sessionOpen、sessionClose 标明开收盘。导入前核对样本的历史可用性。</p></details><a class="btn" href="/nova/shortline/sample-kline.csv" download>下载合成教学样本</a>',async form=>{const file=form.get('csv');if(!file?.size)throw Error('请选择 CSV 文件');if(file.size>2*1024*1024)throw Error('文件超过 2 MiB');const csv=await file.text();if(new TextEncoder().encode(JSON.stringify({revision:state.revision,action:'k:import',payload:{csv}})).length>2*1024*1024)throw Error('请求超过 2 MiB，请按交易日拆批导入');const saved=await ui.save('k:import',{csv});v.asOf='';v.id='';v.page=0;ui.toast('已导入 '+saved.count+' 根 K 线，重复 '+saved.duplicates+' 根');redraw();}));
  on('#kCorrection','click',()=>{if(!selected)return;ui.modal('修正历史信号','<p class="k-note">'+esc(selected.date+' · '+selected.name+' · '+(selected.strategy||'尚无信号'))+'</p><label class="field">修正类型<select name="mode">'+opts(['更正信号','补记信号','撤销信号'],selected.strategy?'更正信号':'补记信号')+'</select></label><label class="field">战法<select name="strategy">'+opts(uniq([selected.strategy,...(state.catalog||[]).filter(x=>x.kind==='strategy').map(c=>c.name)]),selected.strategy)+'</select></label><label class="field">修正依据<textarea name="reason" required maxlength="500"></textarea></label><p class="k-note">修正保留原始行情和登记时间。请将观察截止日调至登记日或之后查看新标注。</p>',async f=>{await ui.save('k:correct',{id:selected.id,...Object.fromEntries(f)});v.asOf=new Date(Date.now()+8*36e5).toISOString().slice(0,10);ui.toast('修正记录已存档');redraw();});});
  on('#kExport','click',()=>{
    const header=['信号日期','标的','代码','题材','战法','类型','风险','样本质量',...DIM_NAMES,...HORIZONS.flatMap(h=>[h+'日收盘收益%',h+'日最高收益%',h+'日最低收益%',h+'日成熟日期',h+'日跟踪事件'])];
    const lines=[header,...pointRows.map(s=>[s.date,s.name,s.code,s.sector,s.strategy,s.type,s.risks.join('、'),s.quality,...DIMENSIONS.map(k=>s.features[k]),...HORIZONS.flatMap(h=>[s.outcomes[h]?.close,s.outcomes[h]?.high,s.outcomes[h]?.low,s.outcomes[h]?.end,s.outcomes[h]?.events.join('、')])])];
    ui.download('K线回测-'+(symbol||'全库')+'-'+asOf+'.csv','\uFEFF'+lines.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');});
}
function detailPane(state,s){
  const f=s.features, row=(key,value)=>'<div><small>'+esc(key)+'</small><b>'+esc(value??MISSING)+'</b></div>';
  const dd=s.date.slice(0,10);
  // Daily context is unavailable until 15:00 for intraday observations.
  const e=(!s.date.includes(' ') || stamp(s.date)>=stamp(dd)) ? emotion(marketAsOf(state,dd,stamp(s.date)),dd) : {stage:'未判定',missing:['盘中无当日完整收盘证据']};
  return '<p class="k-note">'+esc([s.date,s.name,s.code,s.strategy||'未触发信号',s.quality].join(' · '))+'</p><div class="k-detail-grid">'+[['单K形态 / 位置',f.shape+' / '+f.position],['均线 / 平台',f.maState+' / '+f.structure],['距 MA5 / 10 / 20',[f.d5,f.d10,f.d20].map(v=>display(v)).join(' / ')],['量能 / 量比',f.volume+' / '+display(f.ratio,'')],['量价 / 换手',f.relation+' / '+f.turnover],['全A趋势 / 量能',f.indexTrend+' / '+f.indexVolume],['宽度 / 共振',f.breadth+' / '+f.resonance],['题材 / 周期',s.sector+' / '+f.themeCycle],['梯队 / 助攻',f.ladder+' / '+(f.sectorAssists??MISSING)],['题材天数 / 龙头',(f.themeAge??MISSING)+' / '+f.sectorLeader],['筹码峰 / 套牢盘',(f.chipPeak??MISSING)+' / '+display(f.lockedRatio)],['指数收盘 / 涨跌幅',(s.context.indexClose??MISSING)+' / '+display(s.context.indexChange)],['板块收盘 / 涨跌幅',(s.context.sectorClose??MISSING)+' / '+display(s.context.sectorChange)],['情绪判定',e.stage],['开仓校验',s.gate?s.gate.status+' · '+s.gate.position+'%':'技术研究观察'],['风险因子',s.risks.join('、')||'未标注']].map(([k,v])=>row(k,v)).join('')+'</div>'+(s.edit?'<p class="k-note">修正记录 · '+esc(s.edit.recordedAt+' · 原始信号：'+(s.originalStrategy||'无')+' · '+s.edit.reason)+'</p>':'')+'<div class="table-wrap"><table><thead><tr><th>持有窗口</th><th>最高收益</th><th>最低收益</th><th>收盘收益</th><th>已知事件</th><th>标签成熟日</th></tr></thead><tbody>'+HORIZONS.map(h=>{const o=s.outcomes[h];return '<tr><td>T + '+h+'</td><td>'+display(o?.high)+'</td><td>'+display(o?.low)+'</td><td>'+display(o?.close)+'</td><td>'+esc((o?.events.join('、')||'未标注')+(o?.blackSwan?' · 窗口含突发冲击':''))+'</td><td>'+esc(o?.end||'待成熟 / 无可用成交')+'</td></tr>';}).join('')+'</tbody></table></div>';
}
