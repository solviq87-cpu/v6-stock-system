import {modelFrame} from './model-context.mjs';
import {factorDictionary,factorPacket} from './factor-dictionary.mjs';

export function renderPreflight(ui){
  const {state,root,esc}=ui,book=state.book||{id:'main',name:'主研究账户'},can=state.permissions?.canWrite;
  const disabled=can?'':' disabled',demo=book.id==='demo';
  const count=(key)=>state[key]?.length||0;
  root.innerHTML='<section class="panel mk-spaced"><h3>'+esc(book.name)+' · 开始使用</h3>'+
    '<p>已有 '+count('bars')+' 根 K 线、'+count('trades')+' 笔交易、'+count('checks')+' 条校验。</p>'+
    '<div class="mk-chips"><button class="btn primary" data-go="import">导入同花顺涨停列表或 K 线</button> <button class="btn" data-go="trades">录入第一笔交易</button> <button class="btn" data-go="settings">设置参数与黑名单</button></div>'+
    '<p>演示库使用合成行情、冻结计划和模拟成交，独立计算统计。正式账户可在上方切换。</p>'+
    '<button class="btn" data-seed'+disabled+'>'+(demo&&state.demoVersion?'打开演示总览':'一键体验演示数据')+'</button> '+
    (book.id==='main'?'<button class="btn" data-create'+disabled+'>新建研究账户</button>':'')+'</section>'+
    '<section class="panel"><h3>样本库保护</h3><p>重置将清空本账户的交易样本、冻结计划、批注、行情、回测、复盘和学习版本。保留账户、预设、黑名单和自定义标签。原始 V6 成交账本独立保存。</p>'+
    '<button class="btn" data-lock'+disabled+'>'+(state.resetLocked?'解除清空保护':'锁定，禁止清空')+'</button> '+
    '<button class="btn" data-reset'+(can&&!state.resetLocked?'':' disabled')+'>重置本账户样本</button></section>';
  root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>ui.open(b.dataset.go));
  root.querySelector('[data-seed]').onclick=async()=>{await ui.demo();};
  const create=root.querySelector('[data-create]');
  if(create)create.onclick=()=>ui.modal('新建独立研究账户','<label class="field">账户名<input name="name" required maxlength="32" placeholder="例如：小仓试错"></label>',async data=>{
    const result=await ui.save('book:create',{name:data.get('name')});ui.switchBook(result.id,'setup');
  });
  root.querySelector('[data-lock]').onclick=async()=>{try{await ui.save('book:lock',{locked:!state.resetLocked});renderPreflight(ui);}catch(e){ui.toast(e.message);}};
  root.querySelector('[data-reset]').onclick=()=>ui.modal('重置 '+book.name,'<p>将清除 '+count('trades')+' 笔交易、'+count('bars')+' 根 K 线及其派生记录。此操作无法在页面撤销。</p><label class="field">请输入「清空'+esc(book.name)+'」<input name="confirmation" required autocomplete="off"></label>',async data=>{
    await ui.save('book:reset',{book:book.id,confirmation:data.get('confirmation')});ui.toast('当前账户样本已清空');ui.switchBook(book.id,'setup');
  });
}
export function renderDictionary(ui){
  const {state,root,esc}=ui,dict=factorDictionary(state.catalog||[]);
  const draw=(query='')=>{
    const entries=dict.entries.filter(e=>(e.code+e.name+e.group+e.meaning+(e.conditions||[]).join('')).toLowerCase().includes(query.trim().toLowerCase()));
    root.querySelector('[data-results]').innerHTML=entries.map(e=>'<tr><td>'+esc(e.code)+'</td><td>'+esc(e.name)+'</td><td>'+esc(e.group)+'</td><td>'+esc(e.conditions?.map((c,i)=>(i+1)+' · '+c).join('；')||e.meaning)+'</td></tr>').join('');
    root.querySelector('[data-count]').textContent=entries.length+' 项';
  };
  root.innerHTML='<section class="panel"><h3>因子代号词典</h3><p>模型上下文使用词典 '+esc(dict.version)+'。新会话随附映射，已载入同版映射的会话可只导出代号。</p><div class="mk-chips"><label>查找代号或释义 <input data-query type="search"></label> <span data-count></span> <label>模型会话 <select data-session><option value="new">新会话 / 恢复映射</option><option value="resume">已载入同版本映射</option></select></label> <button class="btn" data-packet>导出模型上下文</button> <button class="btn" data-map>导出映射表</button></div><div class="table-wrap"><table><thead><tr><th>代号</th><th>中文释义</th><th>分类</th><th>释义 / 原始条件</th></tr></thead><tbody data-results></tbody></table></div></section>';
  root.querySelector('[data-query]').oninput=e=>draw(e.target.value);
  root.querySelector('[data-packet]').onclick=async()=>{try{const packet=ui.readView?await ui.readView('model'):factorPacket(state);const source=packet.mapping?{version:packet.dictionary,entries:packet.mapping}:dict;const ack=root.querySelector('[data-session]').value==='resume'?source.version:'';ui.download('V6-短线因子上下文.json',JSON.stringify(modelFrame(packet,source,ack)),'application/json');}catch(e){ui.toast(e.message);}};
  root.querySelector('[data-map]').onclick=()=>ui.download('V6-因子词典-'+dict.version+'.json',JSON.stringify({version:dict.version,entries:dict.entries}),'application/json');
  root.querySelector('[data-query]').value=ui.factor||'';draw(ui.factor||'');
}
