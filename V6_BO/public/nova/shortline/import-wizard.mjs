// Import receipt time is assigned here by the authenticated server action.
const source='同花顺客户端人工导出',provider='ths-desktop';
const maxBytes=2*1024*1024, maxRows=20000;
const enc=new TextEncoder();
const fieldLabels={date:'交易日 / K线结束时间',code:'证券代码',name:'证券名称',theme:'题材原文',boardCode:'供应商板块代码',streak:'连续涨停数',firstSeal:'首次封板时间',lastSeal:'最终封板时间',openCount:'开板次数',open:'开盘价',high:'最高价',low:'最低价',close:'收盘价',volume:'成交量',amount:'成交额',turnover:'换手率'};
const fields={pool:['date','code','name','theme','boardCode','streak','firstSeal','lastSeal','openCount'],kline:['date','code','name','open','high','low','close','volume','amount','turnover']};
const aliases={date:['日期','交易日期','交易日','时间','日期时间'],code:['股票代码','证券代码','代码'],name:['股票名称','证券名称','名称','股票简称'],theme:['所属题材','涨停原因类别','涨停原因','题材','所属概念'],boardCode:['题材代码','板块代码'],streak:['连续涨停数','连板数','连板高度'],firstSeal:['首次涨停时间','首次封板时间'],lastSeal:['最后涨停时间','最终封板时间','最后封板时间'],openCount:['开板次数','炸板次数'],open:['开盘','开盘价'],high:['最高','最高价'],low:['最低','最低价'],close:['收盘','收盘价'],volume:['成交量','成交量(手)','成交量(股)','总手'],amount:['成交额','成交金额','成交额(元)','成交额(万元)','成交额(亿元)'],turnover:['换手','换手率','换手率(%)']};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wall=t=>new Date(t+8*36e5).toISOString().slice(0,16).replace('T',' ');
const dayOK=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const barId=b=>[b.role||'stock',b.code,b.period||'日K',b.date].join('/');
const option=(v,label,current)=>'<option value="'+esc(v)+'"'+(String(v)===String(current)?' selected':'')+'>'+esc(label)+'</option>';
export function decodeVendorCsv(buffer){
 const a=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 if(!a.length||a.length>maxBytes)throw Error('文件须为 1 字节至 2 MiB');
 if(a[0]===0xff&&a[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(a);
 if(a[0]===0xfe&&a[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(a);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(a);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(a);}
}
export function readVendorTable(input){
 if(typeof input!=='string'||enc.encode(input).length>maxBytes)throw Error('每批 CSV 不能超过 2 MiB');
 const text=input.replace(/^\uFEFF/,'');if(text.includes('\0'))throw Error('不是文本 CSV；请先在表格软件中另存为 CSV');
 const header=text.split(/[\r\n]/,1)[0],sep=header.includes('\t')?'\t':',';
 const rows=[];let cells=[],value='',quoted=false,ended=false,line=1,start=1;
 function finish(){cells.push(value.trim());if(cells.some(Boolean))rows.push({line:start,cells});cells=[];value='';ended=false;}
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;ended=true;}}else{value+=c;if(c==='\n')line++;}continue;}
  if(c===sep){cells.push(value.trim());value='';ended=false;continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;finish();start=++line;continue;}
  if(c==='"'){if(value||ended)throw Error('第 '+line+' 行引号位置无效');quoted=true;continue;}
  if(ended&&!/\s/.test(c))throw Error('第 '+line+' 行闭引号后有多余字符');
  value+=c;
 }
 if(quoted)throw Error('第 '+start+' 行引号未闭合');finish();
 if(rows.length<2||rows.length>maxRows+1)throw Error('需要表头及 1 至 20,000 条记录');
 if(rows[0].cells.length>100)throw Error('最多支持 100 列');
 return {headers:rows[0].cells,rows:rows.slice(1)};
}
export function guessMapping(headers,kind){
 const normalized=headers.map(h=>h.trim().toLowerCase().replaceAll('（','(').replaceAll('）',')').replace(/\s+/g,''));
 return Object.fromEntries((fields[kind]||[]).map(k=>[k,normalized.findIndex(h=>[k.toLowerCase(),...aliases[k]].includes(h))]));
}
function parseDate(raw){
 let s=String(raw||'').trim().replace(/\//g,'-').replace(/^(\d{4})(\d\d)(\d\d)(?=\s|$)/,'$1-$2-$3').replace('T',' ').replace(/(:\d\d):00$/,'$1');
 s=s.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=\s|$)/,(_,y,m,d)=>y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0'));
 if(!/^\d{4}-\d\d-\d\d(?: (?:[01]\d|2[0-3]):[0-5]\d)?$/.test(s)||!dayOK(s.slice(0,10)))throw Error('日期应为年-月-日，分钟线须包含结束时分');
 return s;
}
function cleanCode(raw){
 const s=String(raw||'').trim().replace(/^(?:SH|SZ|BJ)(?=\d{6}$)|\.(?:SH|SZ|BJ)$/gi,'').replace(/^="(\d{6})"$/,'$1').replace(/^'(\d{6})$/,'$1');
 if(!/^\d{6}$/.test(s))throw Error('股票或指数代码需保留六位数字');return s;
}
function numeral(v,label,min,max,integer=false){
 const raw=String(v??'').replace(/,/g,'').replace(/%$/,'').trim();
 if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error(label+' 不是有效数值');
 const n=Number(raw);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isSafeInteger(n))throw Error(label+' 超出范围');return n;
}
function sealTime(v){
 let s=String(v).replace(/^(\d\d)(\d\d)(\d\d)$/,'$1:$2:$3').replace(/^(\d\d):(\d\d)$/,'$1:$2:00');
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(s))throw Error('封板时间应为 HH:mm:ss');return s;
}
function sampleRole(input){
 if(!['stock','index'].includes(input.role||'stock'))throw Error('K线类型无效');
 if(!['日K','1分钟','5分钟','15分钟','30分钟','60分钟'].includes(input.period||'日K'))throw Error('K线周期无效');
 if(input.priceBasis!=='unadjusted')throw Error('必须确认已选不复权原始价');
 if(!['shares','lots'].includes(input.volumeUnit))throw Error('请选择源文件成交量单位');
 return input.role||'stock';
}
export function previewVendorImport(payload,now=Date.now()){
 const {kind,csv}=payload;if(!Object.hasOwn(fields,kind))throw Error('请选择涨停列表或 K 线');
 const {headers,rows}=readVendorTable(csv);
 const mapping=payload.mapping||guessMapping(headers,kind),used=new Set();
 for(const k of fields[kind]){const i=mapping[k];if(i==null||i===-1)continue;if(!Number.isInteger(i)||i<0||i>=headers.length||used.has(i))throw Error('列映射无效或同一列被重复使用');used.add(i);}
 const required=kind==='pool'?['name']:['open','high','low','close','volume'];
 if(!payload.defaultCode||kind==='pool')required.push('code');
 if(kind==='kline'||!dayOK(payload.tradeDate))required.push('date');
 for(const k of required)if(!Number.isInteger(mapping[k])||mapping[k]<0)throw Error('请映射 '+fieldLabels[k]);
 const role=kind==='kline'?sampleRole(payload):null,period=payload.period||'日K';
 const output=[],errors=[],known=wall(now);
 for(const raw of rows)try{
  if(raw.cells.length!==headers.length)throw Error('实际列数 '+raw.cells.length+'，表头 '+headers.length+' 列');
  const cell=k=>raw.cells[mapping[k]]||'';
  const date=parseDate(cell('date')||payload.tradeDate);
  const code=cleanCode(cell('code')||payload.defaultCode);
  if([0,6].includes(new Date(date.slice(0,10)+'T00:00:00Z').getUTCDay()))throw Error('周末不是 A 股交易日');
  const name=cell('name')||code;if(name.length>60)throw Error('名称超过 60 字');
  if(kind==='pool'){
   if(date.length!==10||date>known.slice(0,10))throw Error('涨停列表需使用已发生的交易日期');
   const rec={tradeDate:date,code,name,source};const theme=cell('theme');
   if(theme.length>240)throw Error('题材原文超过 240 字');if(theme)rec.theme=theme;
   if(cell('boardCode')){if(!/^[A-Za-z0-9._-]{1,32}$/.test(cell('boardCode')))throw Error('板块代码格式无效');rec.boardCode=cell('boardCode');}
   for(const k of ['streak','openCount'])if(cell(k))rec[k]=numeral(cell(k),fieldLabels[k],k==='streak'?1:0,300,true);
   for(const k of ['firstSeal','lastSeal'])if(cell(k))rec[k]=sealTime(cell(k));
   if(rec.firstSeal&&rec.lastSeal&&rec.firstSeal>rec.lastSeal)throw Error('首次封板迟于最终封板');
   output.push({line:raw.line,record:rec});
  }else{
   const minute=date.length>10;
   if(minute===(period==='日K')||(minute?date:date+' 15:00')>known)throw Error('日期与周期不匹配或尚未收盘');
   const rec={role,code,date,name,period,source,priceBasis:'unadjusted',volumeUnit:'shares'};
   for(const k of ['open','high','low','close'])rec[k]=numeral(cell(k),fieldLabels[k],Number.MIN_VALUE,1e9);
   if(rec.high<Math.max(rec.open,rec.close,rec.low)||rec.low>Math.min(rec.open,rec.close))throw Error('最高、最低不能跨过开收盘价');
   const rawVolume=numeral(cell('volume'),'成交量',0,Number.MAX_SAFE_INTEGER)*(payload.volumeUnit==='lots'?100:1);
   rec.volume=Math.round(rawVolume);if(!Number.isSafeInteger(rec.volume)||Math.abs(rec.volume-rawVolume)>1e-6)throw Error('成交量换算后应为有效的整数股数');
   if(cell('amount')){const mult={yuan:1,wan:1e4,yi:1e8}[payload.amountUnit];if(!mult)throw Error('请选择源文件成交额单位');rec.amount=numeral(cell('amount'),'成交额',0,1e15)*mult;if(rec.amount>1e16)throw Error('成交额超出范围');}
   if(cell('turnover'))rec.turnover=numeral(cell('turnover'),'换手率',0,100);
   output.push({line:raw.line,record:rec});
  }
 }catch(e){errors.push({line:raw.line,message:e.message});}
 return {headers,rows:output,errors};
}
function equalRecord(old,raw){return Object.keys(raw).every(k=>old[k]===raw[k]);}
export function importAction(state,action,input){
 if(action!=='import:ths')throw Error('未知导入操作');
 const now=Date.now(),batchId=crypto.randomUUID(),availableAt=wall(now),{rows,errors}=previewVendorImport(input,now);
 if(errors.length)throw Error(errors.slice(0,15).map(e=>'第 '+e.line+' 行：'+e.message).join('；')+(errors.length>15?' 等 '+errors.length+' 处错误':''));
 if(state.scope==='live'&&rows.some(({record})=>/^合成教学样本/.test(record.name)))throw Error('教学格式示例只用于演示，请在正式档案使用实际行情');
 const baseBars=state.bars||[],basePools=state.importedLimitPools||[],seen=new Map(),fresh=[];
 if(input.kind==='kline')for(const b of baseBars)seen.set(barId(b),b);
 else for(const batch of basePools)for(const row of batch.rows)seen.set(row.tradeDate+'/'+row.code,row);
 for(const {line,record:r} of rows){
  const id=input.kind==='pool'?r.tradeDate+'/'+r.code:barId(r),prev=seen.get(id);
  if(prev){if(!equalRecord(prev,r))errors.push({line,message:'相同交易日/时点已有不同记录：'+r.code});continue;}
  seen.set(id,r);fresh.push(r);
 }
 if(errors.length)throw Error(errors.slice(0,15).map(e=>'第 '+e.line+' 行：'+e.message).join('；'));
 if(input.kind==='kline'&&baseBars.length+fresh.length>50000||input.kind==='pool'&&seen.size>50000)throw Error('研究库上限 50,000 条，原批次已保留');
 const duplicates=rows.length-fresh.length;if(!fresh.length)return {count:0,duplicates};
 const stamp={knownAt:now,availableAt,source,provider,sampleSet:state.scope==='demo'?'test':'real'};
 const validDays=[...new Set(fresh.map(r=>(r.tradeDate||r.date).slice(0,10)))].sort();
 if(input.kind==='kline')state.bars=baseBars.concat(fresh.map(r=>({...r,...stamp,importBatchId:batchId})));
 else{
  const byDay=new Map();for(const r of fresh){if(!byDay.has(r.tradeDate))byDay.set(r.tradeDate,[]);byDay.get(r.tradeDate).push(r);}
  state.importedLimitPools=basePools.concat([...byDay].map(([tradeDate,records])=>({...stamp,id:batchId+'/'+tradeDate,batchId,tradeDate,scope:'同花顺导出选中范围',complete:false,rows:records})));
 }
 const item={id:batchId,...stamp,kind:input.kind,count:fresh.length,duplicates,days:validDays,fileName:String(input.fileName||'CSV').slice(0,160)};
 (state.importBatches||=[]).push(item);return item;
}

const examples={
 pool:'交易日期,证券代码,证券名称,所属题材,板块代码,连板数,首次封板时间,开板次数\r\nYYYY-MM-DD,六位代码,实际简称,源文件题材,原板块代码,2,09:35:01,1',
 kline:'日期,证券代码,证券名称,开盘价,最高价,最低价,收盘价,成交量(手),成交额(元),换手率(%)\r\nYYYY-MM-DD,六位代码,实际简称,10.00,10.50,9.80,10.20,1000,1010000,1.25'
};
export function renderImport(ui){
 const {root}=ui;let kind='pool',fileName='',csv='',table=null,map={},feedback='',busy=false,seq=0;
 let defaults={role:'stock',period:'日K',defaultCode:'',tradeDate:'',priceBasis:'',volumeUnit:'',amountUnit:''};
 const select=(key,opts)=>'<select data-option="'+key+'">'+opts.map(([v,l])=>option(v,l,defaults[key])).join('')+'</select>';
 const payload=()=>({...defaults,kind,csv,mapping:map,fileName});
 function show(text){root.querySelector('[data-feedback]').textContent=text;}
 function validation(){
  const result=previewVendorImport(payload());const box=root.querySelector('[data-preview]');
  box.innerHTML='<h3>解析预览</h3><p>'+result.rows.length+' 条格式有效，'+result.errors.length+' 处行错误</p>'+
   (result.errors.length?'<details open><summary>逐行错误（共 '+result.errors.length+' 处）</summary><ol>'+result.errors.slice(0,100).map(x=>'<li>第 '+x.line+' 行 · '+esc(x.message)+'</li>').join('')+'</ol>'+(result.errors.length>100?'<button class="btn" data-errors>导出全部错误</button>':'')+'</details>':'')+
   '<div class="table-wrap"><table><thead><tr><th>原行</th><th>标的</th><th>交易日或时点</th><th>原始记录</th></tr></thead><tbody>'+result.rows.slice(0,8).map(({line,record:r})=>'<tr><td>'+line+'</td><td>'+esc(r.code+' '+r.name)+'</td><td>'+esc(r.date||r.tradeDate)+'</td><td>'+esc(kind==='pool'?[r.theme,r.streak?r.streak+' 板':''].filter(Boolean).join(' · '):'收盘 '+r.close+' · '+r.volume+' 股')+'</td></tr>').join('')+'</tbody></table></div>';
  const all=box.querySelector('[data-errors]');if(all)all.onclick=()=>ui.download('导入错误.txt',result.errors.map(e=>'第 '+e.line+' 行 · '+e.message).join('\n'),'text/plain;charset=utf-8');
  return result;
 }
 function draw(){
  const expanded=root.querySelector('[data-optional-import]')?.open||!!table;
  const batches=(ui.state.importBatches||[]).slice(-8).reverse();
  root.innerHTML='<section class="panel"><h2>自动同步行情</h2><p>'+esc([ui.stock,ui.date].filter(Boolean).join(' · '))+' · 已归档 '+(ui.state.bars||[]).length+' 根行情记录</p><details data-optional-import '+(expanded?'open':'')+'><summary>使用自己的同花顺 CSV（可选）</summary><h3>同花顺 CSV 导入</h3><div class="grid2"><label class="field">导入对象<select data-kind>'+option('pool','涨停列表',kind)+option('kline','历史 K 线',kind)+'</select></label><label class="field">选择 CSV / 制表符文本<input data-file type="file" accept=".csv,.txt,.tsv,text/csv"></label></div>'+
   '<details><summary>同花顺导出路径、格式与示例</summary><p>电脑客户端在「行情 → 涨停聚焦／涨停分析」选交易日，打开涨停个股列表后使用表格右键或工具菜单的「数据导出」。K 线可从个股历史行情表或「系统 → 数据导出」选择证券、周期和不复权行情。各版本菜单名称可能不同，以客户端实际导出功能为准。</p><p>选择表格数据（含列名），保存为 CSV 或制表符文本。只有 Excel 导出时可在表格软件中另存 CSV。支持 UTF-8、GBK/GB18030 和带字节序标记的 UTF-16。六位代码须保留前导零。</p><button class="btn" data-example>下载本类格式示例</button></details>'+
   '<p>每批最多 2 MiB / 20,000 行。已存在的相同记录会跳过，冲突或无效行将阻止整批写入。可知时间按服务器实际接收时点保存。</p>'+
   (table?'<h3>'+esc(fileName)+' · '+table.rows.length+' 行</h3><div class="grid2">'+fields[kind].map(k=>'<label class="field">'+fieldLabels[k]+'<select data-map="'+k+'">'+option(-1,'此列未提供',map[k])+table.headers.map((h,i)=>option(i,(i+1)+' · '+h,map[k])).join('')+'</select></label>').join('')+'</div>'+
    (kind==='pool'?'<label class="field">无日期列时，填写该导出列表的原交易日<input type="date" data-option="tradeDate" value="'+esc(defaults.tradeDate)+'"></label>':'<div class="grid2"><label class="field">证券类型'+select('role',[['stock','个股'],['index','指数']])+'</label><label class="field">K 线周期'+select('period',['日K','1分钟','5分钟','15分钟','30分钟','60分钟'].map(x=>[x,x]))+'</label><label class="field">单标的文件无代码列时的六位代码<input data-option="defaultCode" maxlength="6" value="'+esc(defaults.defaultCode)+'"></label><label class="field">源文件价格口径'+select('priceBasis',[['','请选择'],['unadjusted','已确认不复权']])+'</label><label class="field">源文件成交量单位'+select('volumeUnit',[['','请选择'],['shares','股'],['lots','手（每手 100 股）']])+'</label><label class="field">源文件成交额单位'+select('amountUnit',[['','未提供'],['yuan','元'],['wan','万元'],['yi','亿元']])+'</label></div>')+
    '<div><button class="btn" data-validate>预览并逐行检查</button> <button class="btn primary" data-save>校验并导入整批</button></div><div data-preview></div>':'')+
    '<p role="status" data-feedback>'+esc(feedback)+'</p></details></section><section class="panel"><h2>最近导入</h2>'+batches.map(b=>'<p>'+esc(b.availableAt)+' · '+esc(b.fileName)+' · 新增 '+b.count+' 条 · 重复 '+b.duplicates+' 条</p>').join('')+'</section>';
  root.querySelector('[data-kind]').onchange=e=>{seq++;kind=e.target.value;table=null;csv='';fileName='';feedback='';draw();};
  root.querySelector('[data-example]').onclick=()=>ui.download('同花顺-'+kind+'-格式示例.csv','\uFEFF'+examples[kind],'text/csv;charset=utf-8');
  root.querySelector('[data-file]').onchange=async e=>{
   const f=e.target.files[0],turn=++seq;if(!f)return;
   try{if(f.size>maxBytes)throw Error('文件超过 2 MiB');const raw=decodeVendorCsv(await f.arrayBuffer());
    if(turn!==seq||!root.isConnected)return;const t=readVendorTable(raw);
    table=t;csv=raw;fileName=f.name;map=guessMapping(t.headers,kind);feedback='';
    const volume=t.headers[map.volume]||'',amount=t.headers[map.amount]||'';
    defaults.priceBasis='';defaults.volumeUnit=/手/.test(volume)?'lots':/股/.test(volume)?'shares':'';
    defaults.amountUnit=/亿元/.test(amount)?'yi':/万元/.test(amount)?'wan':/元/.test(amount)?'yuan':'';
    draw();
   }catch(err){if(turn===seq){table=null;csv='';feedback=err.message;draw();}}
  };
  for(const el of root.querySelectorAll('[data-map]'))el.onchange=()=>{map[el.dataset.map]=Number(el.value);root.querySelector('[data-preview]').replaceChildren();};
  for(const el of root.querySelectorAll('[data-option]'))el.oninput=()=>{defaults[el.dataset.option]=el.value;root.querySelector('[data-preview]').replaceChildren();};
  if(table){
   root.querySelector('[data-validate]').onclick=()=>{try{validation();show('');}catch(e){show(e.message);}};
   root.querySelector('[data-save]').onclick=async e=>{
    if(busy)return;busy=true;
    const controls=[...root.querySelectorAll('button,select,input')].filter(el=>!el.disabled);
    controls.forEach(el=>el.disabled=true);
    try{const result=validation();if(result.errors.length)throw Error('请修正原文件后重新选择；本批尚未入库');
     const p=payload();if(enc.encode(JSON.stringify({revision:ui.state.revision,action:'import:ths',payload:p})).length>maxBytes)throw Error('编码后超过接口 2 MiB 限制，请按交易日拆批');
     const saved=await ui.save('import:ths',p);feedback='已完成 · 新增 '+saved.count+' 条 · 重复 '+saved.duplicates+' 条';table=null;csv='';draw();
    }catch(err){show(err.message);}finally{busy=false;controls.forEach(el=>el.disabled=false);}
   };
  }
 }
 draw();
}
