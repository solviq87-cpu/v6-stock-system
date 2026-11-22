import {selectResearchPicks} from './market.js';
import {h,button,section,field,note,empty} from './ui.js';
import {parseStockList,parseStockJson,normalizeCode,workbookPayload,MAX_BYTES,MAX_WORKBOOK_BYTES} from './workbook.js';

export function renderWorkbookImport(ctx,{onSelect}={}) {
  if(ctx.role!=='edit')return section('导入股票清单','使用已认证的编辑身份预览清单。',empty('此功能需要编辑身份'));
  let generation=0,active=null;
  const text=h('textarea',{class:'fy-input',rows:5,placeholder:'粘贴六位代码、CSV/TSV，或JSON股票数组','aria-label':'股票清单文本'});
  const file=h('input',{type:'file',accept:'.csv,.tsv,.txt,.json,.xlsx','aria-label':'股票清单文件'});
  const sheet=h('select',{'aria-label':'工作表'}),sheetField=field('工作表',sheet);sheetField.hidden=true;
  const status=note('先选择文件或粘贴清单，再预览；预览不会采集行情或提交交易。'),output=h('div',{class:'fy-stack'});
  const current=turn=>turn===generation&&!ctx.signal?.aborted;
  function invalidate(message,clearSheets=false){generation++;active?.abort();active=null;output.replaceChildren();status.textContent=message;preview.disabled=false;if(clearSheets){sheet.replaceChildren();sheetField.hidden=true;}}
  function render(result,turn) {
    if(!result||!Array.isArray(result.items)||!Array.isArray(result.rejected)||!Array.isArray(result.duplicates))throw Error('服务端未返回有效清单预览');
    if(result.items.length>100)throw Error('预览超过100只股票，请拆分清单');
    for(const item of result.items){const identity=normalizeCode(typeof item.code==='string'?item.code:'');if(identity.error||identity.exchange!==item.exchange)throw Error('预览包含无效证券代码，请重新读取');}
    status.textContent=result.items.length+' 只待核验 · '+result.duplicates.length+' 条重复 · '+result.rejected.length+' 条未识别';
    const choose=item=>{if(!current(turn))return;if(typeof onSelect==='function')onSelect(item.code,item);else ctx.selectStock(item.code,{code:item.code,name:item.name});};
    output.replaceChildren(result.items.length?h('div',{class:'fy-list'},result.items.map(item=>h('article',{class:'fy-item'},h('strong',{},item.code+' · '+item.exchange),item.name&&h('span',{},item.name+'（导入名称，待核验）'),button('选择研究',()=>choose(item),'quiet')))):empty('没有可选择的股票','请查看未识别项并修正代码。'));
    if(result.rejected.length||result.duplicates.length)output.append(h('details',{class:'fy-details'},h('summary',{},'未识别与重复项'),result.rejected.map(row=>h('p',{},'第 '+row.line+' 行 · '+(row.value||'')+'：'+row.reason)),result.duplicates.map(row=>h('p',{},'第 '+row.line+' 行 · '+row.code+' 与第 '+row.firstLine+' 行重复'+(row.nameConflict?'；导入名称冲突，请核验':'')))));
  }
  const preview=button('预览清单',async()=>{
    invalidate('正在预览…');const turn=generation,selectedFile=file.files?.[0],selectedSheet=sheet.value||'',draft=text.value;
    const controller=new AbortController();active=controller;preview.disabled=true;
    try{
      if(selectedFile&&/\.xlsx$/i.test(selectedFile.name)){
        if(selectedFile.size>MAX_WORKBOOK_BYTES)throw Error('XLSX文件不能超过512KB');
        const bytes=new Uint8Array(await selectedFile.arrayBuffer());if(!current(turn))return;
        const data=await ctx.api('/api/research/import-workbook',{method:'POST',body:workbookPayload(bytes,selectedSheet),signal:controller.signal,timeoutMs:15000});
        if(!current(turn))return;
        const result=data.result;if(!result||!Array.isArray(result.sheets)||result.sheets.length>100)throw Error('服务端未返回有效工作表目录');
        const sheets=result.sheets.filter(row=>row&&typeof row.name==='string'&&row.name.length<=80&&typeof row.available==='boolean');
        if(sheets.length!==result.sheets.length)throw Error('工作表目录无效');
        sheet.replaceChildren(h('option',{value:''},'请选择工作表'),...sheets.map(row=>h('option',{value:row.name,disabled:!row.available},row.name+(row.available?'':'（隐藏，不导入）'))));
        sheetField.hidden=false;sheet.value=result.selected||'';
        if(result.preview)render(result.preview,turn);else status.textContent='含多个工作表，选择一张后再点击预览。';
      }else{
        let source=draft,json=false;
        if(selectedFile){if(!/\.(csv|tsv|txt|json)$/i.test(selectedFile.name))throw Error('请选择CSV、TSV、TXT、JSON或XLSX；旧版XLS请先另存为XLSX');if(selectedFile.size>MAX_BYTES)throw Error('文本文件不能超过100KB');source=await selectedFile.text();json=/\.json$/i.test(selectedFile.name);}
        if(!current(turn))return;
        render(json||/^\s*\[/.test(source)?parseStockJson(source):parseStockList(source),turn);
      }
    }catch(error){if(current(turn)){output.replaceChildren();status.textContent=error.name==='AbortError'?'预览已停止，请重新读取':error.message;}}
    finally{if(current(turn)){preview.disabled=false;active=null;}}
  },'primary');
  text.addEventListener('input',()=>{file.value='';invalidate('清单已更改，请重新预览。',true);});
  file.addEventListener('change',()=>{text.value='';invalidate('已选择文件；点击预览后才会读取。XLSX将上传到当前服务解析，不保存文件。',true);});
  sheet.addEventListener('change',()=>invalidate('工作表已更改，请重新预览。'));
  function clear(){text.value='';file.value='';invalidate('清单已清空。',true);}
  ctx.signal?.addEventListener('abort',clear,{once:true});
  for(const event of ['offline','pagehide'])window.addEventListener(event,clear,{...(ctx.signal?{signal:ctx.signal}:{})});
  const automatic=h('div',{class:'fy-stack'});
  function showCurrent(){
    const picks=selectResearchPicks(ctx.state||{});
    automatic.replaceChildren(note(picks.day?picks.day+' · '+picks.label:'正在读取 V6 候选池'),...picks.items.map(row=>button((row.name||row.code)+' '+row.code,()=>onSelect?onSelect(row.code,row):ctx.selectStock(row.code,row),'quiet')));
  }
  showCurrent();ctx.onState?.(showCurrent);
  return section('股票清单入口','自动跟随 V6 精选标的。',automatic,
    h('details',{class:'fy-details'},h('summary',{},'使用自己的股票清单（可选）'),field('粘贴清单',text),field('或选择文件',file),sheetField,h('div',{class:'fy-inline'},preview,button('清空',clear,'quiet')),status,output));
}
