// Human-selected research controls are separate from trained model versions.
const numbers={
  turnoverMin:['健康换手下限（%）',2,19,.1],turnoverMax:['健康换手上限（%）',3,20,.1],
  breakoutVolumeRatio:['突破量比下限',1.3,5,.1],minDailyAmount:['日成交额下限（元）',1e7,1e10,1],
  minAssist:['板块助攻下限（家）',2,20,1],minSealRatio:['封单占成交额下限（%）',3,50,.1],
  maxPosition:['单标的仓位上限（%）',0,20,1],debounceBars:['同类信号去抖窗（根）',1,60,1],
  unlockPercent:['未来30日已公告解禁比例下限（%）',1,100,.1],
  decayHalfLifeDays:['样本衰减半衰期（天）',7,730,1],calendarCap:['日历风险仓位上限（%）',0,20,1]
};
const switches={excludeST:'屏蔽有时点证据的 ST',excludeUnlock:'屏蔽高解禁',excludeRegulated:'屏蔽监管标的',decayEnabled:'启用历史样本权重衰减',monthEnd:'月末缩仓',quarterEnd:'季末缩仓',beforeHoliday:'长假前缩仓',reportSeason:'定期报告披露窗口缩仓'};
const alerts={discipline:'纪律',risk:'风控',signal:'信号',review:'复盘',system:'系统'};
const lists={blockedStocks:100,blockedSectors:40,blockedFactors:80,customTags:40,mutedAlertTypes:5};
const base={preset:'standard',dailyReviewTime:'',turnoverMin:2,turnoverMax:20,breakoutVolumeRatio:1.3,minDailyAmount:1e7,minAssist:2,minSealRatio:3,
  maxPosition:20,debounceBars:3,unlockPercent:5,decayHalfLifeDays:120,calendarCap:5,
  excludeST:true,excludeUnlock:true,excludeRegulated:true,decayEnabled:false,monthEnd:true,quarterEnd:true,beforeHoliday:true,reportSeason:true,
  blockedStocks:[],blockedSectors:[],blockedFactors:[],customTags:[],mutedAlertTypes:[]};
const variants={
  conservative:{turnoverMin:3,turnoverMax:15,breakoutVolumeRatio:1.6,minDailyAmount:3e7,minAssist:3,minSealRatio:5,maxPosition:10,debounceBars:5,calendarCap:3},
  aggressive:{turnoverMin:2,turnoverMax:20,breakoutVolumeRatio:1.3,minDailyAmount:1e7,minAssist:2,minSealRatio:3,maxPosition:20,debounceBars:2,calendarCap:5}
};
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const word=x=>typeof x==='string'&&x.trim()===x&&x.length>=1&&x.length<=40&&!/[\u0000-\u001F<>]/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const validDay=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function time(x){
  if(Number.isSafeInteger(x))return x;
  if(typeof x!=='string'||!validDay(x.slice(0,10)))return NaN;
  if(validDay(x))return Date.parse(x+'T15:00:00+08:00');
  if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(x))return Date.parse(x.replace(' ','T')+'+08:00');
  return /(?:Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
}
function assertKeys(value,allowed){
  if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('配置包含未知字段或格式无效');
}
function config(input,catalog){
  assertKeys(input,Object.keys(base));
  if(Object.keys(base).some(k=>!Object.hasOwn(input,k)))throw Error('配置字段不完整');
  if(!['standard','conservative','aggressive','custom'].includes(input.preset))throw Error('预设类型无效');
  for(const [key,[label,min,max,step]] of Object.entries(numbers)){
    const v=input[key];
    if(!Number.isFinite(v)||v<min||v>max||(step===1&&!Number.isInteger(v)))throw Error(label+'须在 '+min+'–'+max+' 范围内');
  }
  if(input.dailyReviewTime!==''&&!(typeof input.dailyReviewTime==='string'&&/^(?:1[5-9]|2[0-3]):[0-5]\d$/.test(input.dailyReviewTime)))throw Error('收盘网页通知时间须为北京时间15:00–23:59，留空关闭');
  if(input.turnoverMin>=input.turnoverMax)throw Error('换手上限须高于下限');
  for(const k of Object.keys(switches))if(typeof input[k]!=='boolean')throw Error('开关须为布尔值');
  const factors=new Set((catalog||[]).flatMap(r=>r.factors.map((_,i)=>r.id+':'+i)));
  for(const [key,max] of Object.entries(lists)){
    const values=input[key];
    if(!Array.isArray(values)||values.length>max||values.some(x=>!word(x))||new Set(values).size!==values.length)throw Error('清单重复、过长或格式无效');
    if(key==='blockedStocks'&&values.some(v=>!/^\d{6}$/.test(v)))throw Error('个股名单需使用六位股票代码');
    if(key==='blockedFactors'&&values.some(v=>!factors.has(v)))throw Error('因子不在当前95项目录');
    if(key==='mutedAlertTypes'&&values.some(v=>!Object.hasOwn(alerts,v)))throw Error('提醒分类不存在');
  }
  return clone(input);
}
export function settingsAt(state,asOf=Date.now()){
  const cutoff=time(asOf);
  const history=state?.settingsHistory||[];
  let found;
  for(let i=history.length-1;i>=0;i--)if(time(history[i].effectiveAt)<=cutoff){found=history[i];break;}
  return {...(found?.config||base),version:found?.version||0,effectiveAt:found?.effectiveAt||null};
}
function asConfig(state){
  const {version,effectiveAt,...value}=settingsAt(state);
  return clone(value);
}
function append(state,next,action){
  const history=state.settingsHistory||[],now=Date.now(),last=history.at(-1);
  if(last&&time(last.effectiveAt)>now)throw Error('服务器时钟早于已存配置版本');
  const row={version:(last?.version||0)+1,effectiveAt:new Date(now).toISOString(),action,config:next};
  state.settingsHistory=[...history,row];return {version:row.version,effectiveAt:row.effectiveAt};
}
function profiles(input,catalog){
  if(!Array.isArray(input)||input.length>12)throw Error('最多保存12套自定义预设');
  const seen=new Set();
  return input.map(p=>{
    assertKeys(p,['name','config']);if(!word(p.name)||seen.has(p.name))throw Error('预设名称无效或重复');
    seen.add(p.name);return {name:p.name,config:config(p.config,catalog)};
  });
}
export function settingsBackup(state){
  return {schema:'fayo.shortline.settings.v1',config:asConfig(state),profiles:clone(state.settingsProfiles||[])};
}
export function settingsAction(state,action,payload){
  const catalog=state.catalog||[];
  if(action==='settings:save'){
    assertKeys(payload,['config']);
    return append(state,config(payload.config,catalog),'人工保存');
  }
  if(action==='settings:preset'){
    assertKeys(payload,['preset']);
    if(!Object.hasOwn(variants,payload.preset))throw Error('未知预设');
    return append(state,{...asConfig(state),...variants[payload.preset],preset:payload.preset},'切换内置预设');
  }
  if(action==='settings:profile-save'){
    assertKeys(payload,['name']);
    if(!word(payload.name))throw Error('请输入有效预设名称');
    const updated=profiles([...(state.settingsProfiles||[]).filter(p=>p.name!==payload.name),{name:payload.name,config:asConfig(state)}],catalog);
    const result=append(state,asConfig(state),'保存预设 '+payload.name);state.settingsProfiles=updated;return result;
  }
  if(action==='settings:profile-apply'){
    assertKeys(payload,['name']);
    const profile=(state.settingsProfiles||[]).find(p=>p.name===payload.name);
    if(!profile)throw Error('未找到自定义预设');
    return append(state,config(profile.config,catalog),'应用预设 '+profile.name);
  }
  if(action==='settings:restore'){
    assertKeys(payload,['backup']);
    if(JSON.stringify(payload.backup??null).length>128*1024)throw Error('配置备份过大');
    const pack=payload.backup;
    assertKeys(pack,['schema','config','profiles']);
    if(pack.schema!=='fayo.shortline.settings.v1')throw Error('配置备份版本不支持');
    const active=config(pack.config,catalog),saved=profiles(pack.profiles,catalog);
    const result=append(state,active,'人工恢复配置');state.settingsProfiles=saved;return result;
  }
  throw Error('未知配置操作');
}

export function blacklistReason(settings,row={}){
  const code=row.code,sector=row.sector,at=time(row.asOf);
  if(settings.blockedStocks.includes(code))return '个股黑名单 '+code;
  if(sector&&settings.blockedSectors.includes(sector))return '板块屏蔽 '+sector;
  if(!Number.isFinite(at))return '';
  const marks=[row.knownAt,row.availableAt].filter(x=>x!=null);
  const observed=marks.length>0&&marks.every(t=>Number.isFinite(time(t))&&time(t)<=at);
  const known=(key)=>row[key]!=null?(!marks.length||observed)&&Number.isFinite(time(row[key]))&&time(row[key])<=at:observed;
  // Today's display name on a historical OHLC series is not a historical ST flag.
  if(settings.excludeST&&((row.isST===true&&known('statusKnownAt'))||
    (row.nameKnownAt!=null&&known('nameKnownAt')&&/^(?:\*?ST|S\*?ST)/i.test(row.name||''))))return 'ST风险（信号时已知）';
  if(settings.excludeUnlock&&known('unlockKnownAt')&&Number.isFinite(row.unlockPct30d)&&row.unlockPct30d>=settings.unlockPercent)return '已公告未来30日解禁 '+row.unlockPct30d+'%';
  if(settings.excludeRegulated&&known('regulationKnownAt')&&['重点监控','严重异常波动','连续异常波动','监管调查','立案调查'].includes(row.regulationStatus))return '监管状态 '+row.regulationStatus;
  return '';
}

// A disclosed next session can cross a holiday. Otherwise the Gregorian last
// weekday proves only a month boundary if the market actually traded today.
export function calendarWarnings(settings,market,date,asOf,evidence={}){
  const out=[],at=time(asOf);
  if(!validDay(date)||market?.date!==date||!Number.isFinite(at)||[market.knownAt,market.availableAt].filter(x=>x!=null).some(x=>!(time(x)<=at)))return out;
  const source=market.calendarSource,known=time(market.calendarKnownAt),next=market.nextTradingDay;
  const gap=validDay(next)?(Date.parse(next)-Date.parse(date))/864e5:0;
  const verified=typeof source==='string'&&source.trim()&&Number.isFinite(known)&&known<=at&&gap>=1&&gap<=18;
  const end=new Date(date+'T12:00:00Z');
  const weekday=end.getUTCDay();
  if(weekday===0||weekday===6)return out;
  do{end.setUTCDate(end.getUTCDate()+1);}while([0,6].includes(end.getUTCDay()));
  const nextPossible=verified?next:end.toISOString().slice(0,10);
  const month=Number(date.slice(5,7)),edge=nextPossible.slice(0,7)!==date.slice(0,7);
  if(edge&&settings.monthEnd)out.push('月末交易窗口（'+date+'）');
  if(edge&&settings.quarterEnd&&month%3===0)out.push('季末交易窗口（'+date+'）');
  if(settings.beforeHoliday&&verified&&gap>=6)out.push('长假前窗口，下个交易日 '+next+' · '+source);
  // The seasonal cap is explicitly a calendar rule. Individual filing-day
  // claims require a verified schedule with an announcement timestamp.
  if(settings.reportSeason){
    if([4,8,10].includes(month))out.push('定期报告集中披露月（'+month+'月日历规则）');
    const d=evidence.reportDate,t=time(evidence.reportKnownAt);
    if(validDay(d)&&d>=date&&Date.parse(d)-Date.parse(date)<=7*864e5&&evidence.reportSource&&Number.isFinite(t)&&t<=at)
      out.push('已公告报告披露日 '+d+' · '+evidence.reportSource);
  }
  return out;
}

const titles={standard:'标准',conservative:'保守',aggressive:'激进',custom:'自定义'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const listText={blockedStocks:'个股黑名单（代码）',blockedSectors:'屏蔽板块',customTags:'自定义样本标签'};
export function renderSettings(ui){
  const {state,root}=ui;
  const canWrite=state.permissions?.canWrite!==false;
  const btn=(id,label,disabled=false)=>'<button type="button" class="btn" data-setting="'+id+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
  const hint='<p>新版本从保存时刻生效，先前信号沿用当时配置。模型晋级仍需独立验证与人工审批。</p>';
  const field=(key,label,html)=>'<label class="field"><span>'+label+'</span>'+html+'</label>';
  const choices=(selected,options)=>options.map(([id,label])=>'<option value="'+escape(id)+'"'+(selected.includes(id)?' selected':'')+'>'+escape(label)+'</option>').join('');
  function paint(){
    const s=settingsAt(state),saved=state.settingsProfiles||[],history=state.settingsHistory||[];
    const labels=(state.catalog||[]).flatMap(r=>r.factors.map((f,i)=>[r.id+':'+i,r.name+' · '+f]));
    root.innerHTML='<section class="settings-page" style="display:grid;gap:1rem"><section class="panel"><h2>研究配置</h2><p>当前 '+titles[s.preset]+' · V'+s.version+'</p>'+hint
      +'<div class="actions">'+btn('conservative','应用保守阈值',!canWrite)+btn('aggressive','应用激进阈值',!canWrite)+btn('backup','导出配置')+btn('restore','恢复配置',!canWrite)+'</div></section>'
      +'<form class="panel" id="research-settings-form"><fieldset style="border:0;margin:0;padding:0"'+(!canWrite?' disabled':'')+'><h3>因子阈值与仓位</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:.7rem">'
      +Object.entries(numbers).map(([k,[l,min,max,step]])=>field(k,l,'<input type="number" required name="'+k+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+s[k]+'">')).join('')+'</div>'
      +'<h3>风控与样本衰减</h3><div style="display:flex;flex-wrap:wrap;gap:.75rem">'+Object.entries(switches).map(([k,l])=>'<label><input type="checkbox" name="'+k+'"'+(s[k]?' checked':'')+'> '+l+'</label>').join('')+'</div>'
      +'<h3>黑名单与标签</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:.7rem">'
      +Object.entries(listText).map(([k,l])=>field(k,l+'（每行一项）','<textarea rows="4" maxlength="2000" name="'+k+'">'+escape(s[k].join('\n'))+'</textarea>')).join('')
      +field('blockedFactors','因子黑名单（可多选）','<select multiple size="5" name="blockedFactors">'+choices(s.blockedFactors,labels)+'</select>')
      +'</div><h3>静默提醒分类</h3><div style="display:flex;flex-wrap:wrap;gap:.75rem">'+Object.entries(alerts).map(([k,l])=>'<label><input type="checkbox" name="mutedAlertTypes" value="'+k+'"'+(s.mutedAlertTypes.includes(k)?' checked':'')+'> '+l+'</label>').join('')+'</div>'+field('dailyReviewTime','收盘网页通知（北京时间，留空关闭）','<input type="time" name="dailyReviewTime" min="15:00" max="23:59" value="'+escape(s.dailyReviewTime)+'">')+'<p>静默分类仅影响提醒投递。触发的风控与纪律记录照常存档。</p><button class="btn primary" type="submit">保存为新版本</button></fieldset><button type="button" class="btn" data-enable-research-notify>管理本机网页通知</button></form>'
      +'<section class="panel"><h3>命名预设</h3>'+field('profile','预设名称','<input maxlength="40" name="profileName" placeholder="例如 月末防守">')+btn('profile-save','保存当前配置为预设',!canWrite)
      +(saved.length?field('saved','已有预设','<select name="profileChoice">'+choices([],saved.map(p=>[p.name,p.name]))+'</select>')+btn('profile-apply','应用所选预设',!canWrite):'')+'</section>'
      +'<section class="panel"><h3>配置版本记录</h3>'+(history.length?'<ul>'+history.slice(-12).reverse().map(v=>'<li>V'+v.version+' · '+escape(v.action)+' · '+escape(new Date(v.effectiveAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+'</li>').join('')+'</ul>':'<p>当前使用出厂配置。</p>')+'</section></section>';
    const bind=(id,fn)=>root.querySelector('[data-setting="'+id+'"]')?.addEventListener('click',fn);
    const save=async(action,payload)=>{try{await ui.save('settings:'+action,payload);ui.toast('配置已保存');paint();}catch(e){ui.toast(e.message);}};
    for(const preset of Object.keys(variants))bind(preset,()=>save('preset',{preset}));
    bind('backup',()=>ui.download('绯曜-研究配置-V'+s.version+'.json',JSON.stringify(settingsBackup(state),null,2),'application/json'));
    bind('restore',()=>ui.modal('恢复配置','<label class="field">配置 JSON<input type="file" name="file" accept=".json,application/json" required></label><p>恢复会建立一个当前生效的版本。交易、复盘和模型审批历史保留。</p>',async fd=>{
      const file=fd.get('file');if(!file?.size||file.size>128*1024)throw Error('请选择小于128 KiB 的配置 JSON');
      let backup;try{backup=JSON.parse(await file.text());}catch{throw Error('文件不是有效 JSON');}
      await ui.save('settings:restore',{backup});ui.toast('已恢复为新版本');paint();
    }));
    bind('profile-save',()=>save('profile-save',{name:root.querySelector('[name=profileName]').value.trim()}));
    bind('profile-apply',()=>save('profile-apply',{name:root.querySelector('[name=profileChoice]').value}));
    const form=root.querySelector('#research-settings-form');
    form.addEventListener('submit',e=>{
      e.preventDefault();const fd=new FormData(form),next={...asConfig(state),preset:'custom'};
      next.dailyReviewTime=String(fd.get('dailyReviewTime')||'');
      for(const k of Object.keys(numbers))next[k]=Number(fd.get(k));
      for(const k of Object.keys(switches))next[k]=fd.has(k);
      for(const k of Object.keys(listText))next[k]=String(fd.get(k)||'').split(/[\n,，、]/).map(x=>x.trim()).filter(Boolean);
      next.blockedFactors=fd.getAll('blockedFactors');next.mutedAlertTypes=fd.getAll('mutedAlertTypes');
      save('save',{config:next});
    });
  }
  paint();
}
