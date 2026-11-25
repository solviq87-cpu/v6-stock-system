import {h, button, money, note, dateTime} from './ui.js';
import {eligiblePick, systemPickDay} from './system-picks.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const list = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const digits = value => String(value).replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 65296));
const metricNames = {flow: '主力净流入', score: '精选评分', resonance: '共振分'};
function dayOf(value) {
  if (typeof value !== 'string') return null;
  const day = value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const at = Date.parse(day + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day ? day : null;
}
export function selectionCommandDay(state) {
  return dayOf(state?.closeSession?.day) || dayOf(state?.marketClock?.day) ||
    dayOf(state?.dashboard?.snapshotDay) || dayOf(state?.snapshotDay);
}
const unsupported = error => ({ok: false, status: 'unsupported', error});

// A deliberately bounded grammar makes every accepted condition reviewable.
// Unrecognized clauses must not silently disappear from the user's request.
function parseRankingCommand(input) {
  if (typeof input !== 'string' || !input.trim()) return unsupported('请输入选股条件。');
  let text = digits(input).trim().replace(/[\s，,。！!？?]+$/g, '').replace(/\s+/g, '');
  if (text.length > 100) return unsupported('指令过长，请使用一个排序指标和一个题材。');
  text = text.replace(/^(?:请帮我|帮我|请)?(?:筛选|找出|找|查看)?/, '');
  if (/且|并且|或者|或是|不含|排除|大于|小于|涨停|涨幅|市值|利润|收益|明天|明日|保证|买入|卖出|[<>≤≥&|;；]/.test(text))
    return unsupported('当前支持按主力净流入、精选评分或共振分取前 N 只，可加一个题材或行业。');
  let days = 1;
  const period = text.match(/^(?:近|最近)(\d{1,2})(?:个)?(?:交易)?日/);
  if (period) { days = Number(period[1]); text = text.slice(period[0].length); }
  else text = text.replace(/^(?:今日|今天|当日)/, '');
  if (!Number.isInteger(days) || days < 1 || days > 10) return unsupported('资金窗口支持近 1–10 个交易日。');
  const metrics = [...text.matchAll(/主力净流入|精选评分|评分|共振次数|共振分|共振/g)];
  if (metrics.length !== 1) return unsupported('请指定一个排序指标：主力净流入、精选评分或共振分。');
  const found = metrics[0], metric = found[0] === '主力净流入' ? 'flow' : /共振/.test(found[0]) ? 'resonance' : 'score';
  if (metric !== 'flow' && days !== 1) return unsupported('多日窗口只支持主力净流入；评分与共振使用所示交易日的记录。');
  let before = text.slice(0, found.index), after = text.slice(found.index + found[0].length);
  before = before.replace(/(?:按|按照)$/, '');
  after = after.replace(/^(?:排名|最高|最多)/, '');
  const ranking = after.match(/^前(\d{1,2})(?:名|只)?/);
  let limit = 5;
  if (ranking) { limit = Number(ranking[1]); after = after.slice(ranking[0].length); }
  else if (/前|排名|最高|最多/.test(after)) return unsupported('排名数量须为前 1–20 只。');
  if (limit < 1 || limit > 20) return unsupported('排名数量须为前 1–20 只。');
  const themeOf = value => value.replace(/^的/, '').replace(/(?:股票|个股|股)$/, '').replace(/(?:题材|行业|板块)$/, '');
  const a = themeOf(before), b = themeOf(after);
  if (a && b) return unsupported('一次只能限定一个题材或行业。');
  const theme = a || b;
  if (theme && (!/^[\p{Script=Han}A-Za-z0-9]{1,24}$/u.test(theme) || /前\d|净流|评分|共振|近\d|日$/.test(theme)))
    return unsupported('题材格式未识别，请试“近5日主力净流入前5的芯片股”。');
  return {ok: true, metric, days, limit, theme: ['全部', '全市场', '所有', 'A', 'A股'].includes(theme) ? '' : theme,
    explicitAllMarket: theme === '全市场', raw: input.trim()};
}

const filterLabels={score:'精选评分',resonance:'共振分',pct:'涨幅',turnover:'换手率',price:'股价',amount:'成交额',mktcap:'总市值',notST:'排除ST',notHalted:'排除停牌'};
const filterMetric={精选评分:'score',评分:'score',共振次数:'resonance',共振分:'resonance',共振:'resonance',涨跌幅:'pct',涨幅:'pct',换手率:'turnover',股价:'price',价格:'price',成交额:'amount',总市值:'mktcap',市值:'mktcap'};
const comparator={'不低于':'>=','至少':'>=','大于等于':'>=','≥':'>=','>=':'>=','不高于':'<=','至多':'<=','小于等于':'<=','≤':'<=','<=':'<=','大于':'>','超过':'>','>':'>','小于':'<','低于':'<','<':'<','等于':'=','=':'='};
function parseFilter(text){
 if(/^(?:排除|不含|剔除)ST$|^非ST$/i.test(text))return {metric:'notST',op:'exclude',label:'排除ST'};
 if(/^(?:排除|不含|剔除)停牌(?:股)?$/.test(text))return {metric:'notHalted',op:'exclude',label:'排除停牌'};
 const m=/^(精选评分|评分|共振次数|共振分|共振|涨跌幅|涨幅|换手率|股价|价格|成交额|总市值|市值)(不低于|大于等于|小于等于|不高于|至少|至多|超过|大于|小于|低于|等于|>=|<=|≥|≤|>|<|=)([+-]?\d+(?:\.\d+)?)(亿元|万元|亿|万|元|％|%|分|个策略|个|次)?$/.exec(text);
 if(!m)return null;
 const metric=filterMetric[m[1]],unit=m[4]||'',raw=Number(m[3]);
 const allowed=metric==='score'?['','分']:metric==='resonance'?['','个策略','个','次']:['pct','turnover'].includes(metric)?['','%','％']:
  metric==='price'?['','元']:['','元','万元','亿元','万','亿'];
 if(!allowed.includes(unit)||!finite(raw)||Math.abs(raw)>1e12||metric==='resonance'&&!Number.isInteger(raw)||
  ['score','resonance','turnover','price','amount','mktcap'].includes(metric)&&raw<0||metric==='score'&&raw>100)return null;
 const value=raw*(/亿/.test(unit)?1e8:/万/.test(unit)?1e4:1),op=comparator[m[2]],displayUnit=['pct','turnover'].includes(metric)?'%':
  ['amount','mktcap','price'].includes(metric)?'元':metric==='score'?'分':'个策略';
 return {metric,op,value,unit:displayUnit,label:filterLabels[metric]+' '+op+' '+value+' '+displayUnit};
}

export function parseSelectionCommand(input){
 if(typeof input!=='string'||!input.trim())return unsupported('请输入选股条件。');
 const normalized=digits(input).trim().replace(/[。！!？?]+$/g,'').replace(/\s+/g,'');
 if(/^(?:并且|而且|同时|且|[，,；;])|(?:并且|而且|同时|且|[，,；;])$|(?:并且|而且|同时|且|[，,；;])(?:并且|而且|同时|且|[，,；;])/.test(normalized))return unsupported('存在空白条件，请补齐或删除后再执行。');
 if(normalized.length>160)return unsupported('指令最多160字，可使用一个排序条件和至多6个筛选条件。');
 if(/或者|或是|\|\||\bOR\b|明天|明日|保证|必涨|自动买|自动卖/i.test(normalized))return unsupported('暂不解析“或”、未来涨幅或自动买卖要求；可用“且”连接可核验条件。');
 const clauses=normalized.split(/并且|而且|同时|且|[，,；;]/).filter(Boolean);
 if(clauses.length===1)return parseRankingCommand(input);
 if(clauses.length>7)return unsupported('一次最多包含一个排序条件与6个筛选条件。');
 let ranking=null;const filters=[];
 for(const clause of clauses){
  const filter=parseFilter(clause);
  if(filter){filters.push(filter);continue;}
  const candidate=parseRankingCommand(clause);
  if(candidate.ok&&!ranking){ranking=candidate;continue;}
  return unsupported('未识别完整条件：“'+clause+'”。支持评分、共振、涨幅、换手率、股价、成交额、市值比较及排除ST/停牌；未执行其余条件。');
 }
 if(!ranking)return unsupported('请指定排序，例如“精选评分前5”，再用“且”连接筛选条件。');
 return {...ranking,filters,raw:input.trim()};
}

function candidateRows(state, day, now) {
  const first = list(state?.pool), fallback = list(state?.dashboard?.rows);
  const rows = Array.isArray(state?.pool) ? first : fallback;
  const poolDay = dayOf(state?.poolDay || state?.snapshotFieldDays?.candidatePool || state?.snapshotFieldDays?.pool ||
    state?.poolBasis?.day || state?.poolBasis?.date || (!Array.isArray(state?.pool) ? state?.dashboard?.snapshotDay : null));
  const unique = new Map();
  for (const row of rows) {
    if (!eligiblePick(row) || !row.code || systemPickDay(row, poolDay, now) !== day) continue;
    const source = row.quoteSource || row.source;
    if (typeof source !== 'string' || !source.trim() || /synthetic|fixture|mock|demo/i.test(source)) continue;
    // One whole record owns its source and date. A duplicate must not lend its
    // quote timestamp to another row's score, sector, or funds value.
    if (!unique.has(row.code)) unique.set(row.code, row);
  }
  return [...unique.values()];
}
function themesOf(row) {
  return [...new Set([row.sector, row.industry, ...(Array.isArray(row.themes) ? row.themes : []),
    ...(Array.isArray(row.concepts) ? row.concepts : [])].filter(value => typeof value === 'string' && value.trim()))];
}
function themeMatch(row, theme) {
  if (!theme) return true;
  const keys = theme === '芯片' ? ['芯片', '半导体', '集成电路'] : [theme];
  return themesOf(row).some(value => keys.some(key => value.toLocaleLowerCase().includes(key.toLocaleLowerCase())));
}
function ownFunds(row, day, now) {
  const source = row.fundsSource, method = row.fundsMethod, at = row.fundsSourceTimestamp;
  const received = row.fundsRetrievedAt, unit = row.fundsUnit || row.unit;
  if (!finite(row.mainInflow) || typeof source !== 'string' || !source.trim() ||
      method !== 'vendor-order-size-estimate' || unit !== 'CNY' ||
      !Number.isSafeInteger(at) || at <= 0 || at > now || dayOf(new Date(at + 28800000).toISOString().slice(0, 10)) !== day ||
      !Number.isSafeInteger(received) || received < at || received > now) return null;
  return {value: row.mainInflow, source, knownAt: received, from: day, to: day, days: 1};
}
function historyFunds(code, context, days, day, now) {
  if (!context || context.day !== day || context.days !== days || !Array.isArray(context.expectedDays) || context.expectedDays.length !== days) return null;
  const dates = context.expectedDays;
  if (dates.at(-1) !== day || !dates.every((date, i) => dayOf(date) === date && (!i || dates[i - 1] < date))) return null;
  const rows = context.flowHistory?.[code];
  if (!Array.isArray(rows)) return null;
  const selected = dates.map(date => rows.filter(row => row?.date === date));
  if (selected.some(matches => matches.length !== 1)) return null;
  const window = selected.map(matches => matches[0]);
  if (window.some(row => !finite(row.main) || row.unit !== 'CNY' || row.fundsMethod !== 'vendor-order-size-estimate' ||
      typeof row.source !== 'string' || !row.source.trim() || /synthetic|fixture|mock|demo/i.test(row.source) ||
      !Number.isSafeInteger(row.knownAt) || row.knownAt <= 0 || row.knownAt > now || row.knownAt !== row.retrievedAt ||
      row.knownAt < Date.parse(row.date + 'T00:00:00+08:00') ||
      (row.sourceTimestamp != null && (!Number.isSafeInteger(row.sourceTimestamp) || row.sourceTimestamp <= 0 || row.sourceTimestamp > row.knownAt ||
        new Date(row.sourceTimestamp + 28800000).toISOString().slice(0, 10) !== row.date)))) return null;
  if (new Set(window.map(row => row.source)).size !== 1) return null;
  const value = window.reduce((total, row) => total + row.main, 0);
  if (!finite(value)) return null;
  return {value, source: window[0].source, knownAt: Math.max(...window.map(row => row.knownAt)), from: dates[0], to: day, days};
}
function resonanceValue(row, day, resonanceByCode) {
  const record = resonanceByCode instanceof Map ? resonanceByCode.get(row.code) : resonanceByCode?.[row.code];
  if (!record || record.day !== day || !Array.isArray(record.strategies)) return null;
  const strategies = [...new Set(record.strategies.filter(item => item?.day === day && typeof item.id === 'string' && item.id).map(item => item.id))];
  if (!strategies.length || record.count !== strategies.length) return null;
  return {value: strategies.length, strategies, source: '同日独立策略命中'};
}

function conditionEvidence(row,filter,{day,now,resonanceByCode}){
  const metric=filter.metric;
  if(metric==='score')return finite(row.score)&&row.score>=0&&row.score<=100?
    {value:row.score,source:'原候选精选评分',sourceAt:row.strategyAt||row.quoteAt,knownAt:row.receivedAt||null}:null;
  if(metric==='resonance')return resonanceValue(row,day,resonanceByCode);
  if(metric==='notST')return typeof row.name==='string'&&row.name.trim()||typeof row.isST==='boolean'?
    {value:!(row.isST===true||/^(?:S\*?ST|\*+\s*ST|ST)|退市/i.test(row.name||'')),source:row.quoteSource,sourceAt:row.quoteAt}:null;
  if(metric==='notHalted')return typeof row.suspended==='boolean'||typeof row.halt==='boolean'||['normal','trading','suspended','halted'].includes(row.tradeStatus)?
    {value:row.suspended!==true&&row.halt!==true&&!['suspended','halted'].includes(row.tradeStatus),source:row.quoteSource,sourceAt:row.quoteAt}:null;
  if(!['pct','turnover','price','amount','mktcap'].includes(metric)||!finite(row[metric])||
    !Number.isSafeInteger(row.quoteAt)||row.quoteAt<=0||row.quoteAt>now||new Date(row.quoteAt+28800000).toISOString().slice(0,10)!==day||
    !Number.isSafeInteger(row.receivedAt)||row.receivedAt<row.quoteAt||row.receivedAt>now)return null;
  if(['amount','mktcap'].includes(metric)&&row[metric]<0)return null;
  if(['amount','mktcap'].includes(metric)){
    const unit=row[metric+'Unit'];
    if(unit!=null?unit!=='CNY':!(/^(eastmoney|tencent|sina)$/.test(row.quoteSource||'')&&row.quoteMode==='public-live-unverified'))return null;
  }
  return {value:row[metric],source:row.quoteSource,sourceAt:row.quoteAt,knownAt:row.receivedAt,unit:filter.unit};
}
const compares=(value,filter)=>filter.op==='exclude'?value===true:filter.op==='>'?value>filter.value:filter.op==='>='?value>=filter.value:
 filter.op==='<'?value<filter.value:filter.op==='<='?value<=filter.value:filter.op==='='?value===filter.value:false;

export function evaluateSelectionCommand(command, {state = {}, flowContext = null, day = selectionCommandDay(state), now = Date.now(), resonanceByCode = null} = {}) {
  const query = typeof command === 'string' ? parseSelectionCommand(command) : command;
  if (!query?.ok) return {...query, items: []};
  if (!dayOf(day) || day > new Date(now + 28800000).toISOString().slice(0, 10))
    return {ok: false, status: 'data-missing', query, day: null, items: [], message: '当前没有可核实的候选交易日。'};
  if (query.explicitAllMarket) return {ok:false,status:'unsupported-scope',query,day,items:[],message:'全市场覆盖尚未接入本工作台；请明确改为当前候选池后执行。',canTrade:false};
  const rows = candidateRows(state, day, now), matched = rows.filter(row => themeMatch(row, query.theme));
  let missing = 0,filtered = 0;
  const missingConditions={},filters=Array.isArray(query.filters)?query.filters:[];
  const ranked = [];
  for (const row of matched) {
    const checked=filters.map(filter=>({filter,evidence:conditionEvidence(row,filter,{day,now,resonanceByCode})}));
    if(checked.some(({filter,evidence})=>evidence&&!compares(evidence.value,filter))){filtered++;continue;}
    const absent=checked.filter(item=>!item.evidence);
    if(absent.length){missing++;for(const {filter}of absent)missingConditions[filterLabels[filter.metric]||filter.metric]=(missingConditions[filterLabels[filter.metric]||filter.metric]||0)+1;continue;}
    let evidence;
    if (query.metric === 'flow') evidence = historyFunds(row.code, flowContext, query.days, day, now) ||
      (query.days === 1 ? ownFunds(row, day, now) : null);
    else if (query.metric === 'score') evidence = finite(row.score) && row.score >= 0 && row.score <= 100 ? {value: row.score, source: '原候选精选评分'} : null;
    else evidence = resonanceValue(row, day, resonanceByCode);
    if (!evidence) { missing++; continue; }
    if (query.metric === 'flow' && evidence.value <= 0) continue;
    const themes = themesOf(row), label = query.metric === 'flow' ? `近 ${query.days} 个交易日主力净流入` : metricNames[query.metric];
    const amount = query.metric === 'flow' ? money(evidence.value) + ' 元' : String(evidence.value) + (query.metric === 'score' ? ' 分' : ' 个策略');
    const conditionReasons=checked.map(({filter,evidence})=>filter.label+'（实际 '+evidence.value+(evidence.unit||'')+'；'+evidence.source+
      (evidence.sourceAt?'；原时点 '+dateTime(evidence.sourceAt):'')+'）');
    const reason = [query.theme && '题材命中：' + themes.join(' / '),
      label + ' ' + amount, evidence.from && evidence.from + ' 至 ' + evidence.to, evidence.source,...conditionReasons].filter(Boolean).join(' · ');
    ranked.push({...row, poolDay: day, selectionWhy: reason, commandEvidence: evidence, commandMetric: query.metric,
      commandConditions:checked.map(({filter,evidence})=>({condition:filter,...evidence})),
      commandValue: evidence.value, commandDay: day, canTrade: false, commandObservation: true});
  }
  ranked.sort((a, b) => b.commandValue - a.commandValue || a.code.localeCompare(b.code));
  const items = ranked.slice(0, query.limit);
  const status = items.length ? (missing ? 'partial' : 'observed') : matched.length && missing ? 'data-missing' : 'no-match';
  const base = `${day} · 已接收候选 ${rows.length} 只 · 题材匹配 ${matched.length} 只 · 依据完整 ${matched.length - missing} 只`;
  const missingText = missing ? `；${missing} 只缺少${Object.keys(missingConditions).length?Object.keys(missingConditions).join('、')+'的原值、单位或时点':query.metric === 'flow' ? '完整 ' + query.days + ' 个交易日的资金日期、数值或来源' : metricNames[query.metric] + '依据'}` : '';
  return {ok: true, status, query, day, items, coverage: {observed: rows.length, matched: matched.length, missing, filtered,missingConditions,ranked: ranked.length},
    message: base + missingText +(filters.length?'；已逐项核对 '+filters.length+' 个附加条件，排除 '+filtered+' 只':'')+ (items.length ? `；在依据完整的样本中返回前 ${items.length} 只。` : status === 'data-missing' ? '，暂不生成排名。' : '；没有满足本次条件的标的。'),
    scope: '当前已接收候选池，非全市场排名', canTrade: false};
}

export function createCommandSelection(ctx) {
  const result = h('div', {class: 'fy-command-results', 'aria-live': 'polite'});
  const input = h('input', {type: 'text', maxlength: '160', placeholder: '近5日主力净流入前5的芯片股，评分至少80且涨幅小于5%', 'aria-label': '一句话选股指令'});
  const run = h('button', {type: 'submit', class: 'fy-button primary'}, '筛选股票');
  const preview = h('div',{class:'fy-stack','aria-live':'polite','data-selection-preview':'true'});
  const memory = ctx.viewMemory || {};
  const saved = h('div',{class:'fy-inline'});
  const editor=()=>ctx.role==='edit'||ctx.canEdit===true;
  const templateStatus=h('p',{class:'fy-muted','aria-live':'polite'});
  let templateTurn=0;
  async function loadSaved(){
    const turn=++templateTurn;
    try{const response=await ctx.api('/api/research/workspace?panel=templates',{signal:ctx.signal});
      if(!alive()||turn!==templateTurn||!editor())return;
      if(!response?.ok||!Array.isArray(response.result?.templates))throw Error('模板未就绪');
      memory.commandTemplates=response.result.templates.map(x=>x.command).filter(x=>parseSelectionCommand(x).ok);
      paintSaved();templateStatus.textContent='已读取服务器保存的条件，两端共用。';
    }catch(error){if(alive()&&turn===templateTurn){memory.commandTemplates=[];paintSaved();templateStatus.textContent=error.message||'读取失败';}}
  }
  const loadTemplates=editor()?button('读取已保存条件',loadSaved,'quiet'):null;
  const save = button(editor()?'保存条件到研究档案':'保存本次条件（当前会话）',async()=>{
    const q=parseSelectionCommand(input.value);if(!q.ok||q.explicitAllMarket){preview.replaceChildren(note(q.error||'全市场范围未就绪'));return;}
    if(!editor()){memory.commandTemplates=[q.raw,...(memory.commandTemplates||[]).filter(x=>x!==q.raw)].slice(0,6);paintSaved();return;}
    const turn=++templateTurn;save.disabled=true;
    try{const response=await ctx.api('/api/research/workspace',{method:'POST',signal:ctx.signal,body:{action:'fayo-save-command',value:q.raw,requestId:globalThis.crypto?.randomUUID?.()||'cmd-'+Date.now()+'-'+Math.random().toString(36).slice(2)}});
      if(!alive()||turn!==templateTurn||!editor())return;
      if(!response?.ok)throw Error(response?.error||'保存未完成');await loadSaved();
    }catch(error){if(alive()&&turn===templateTurn)templateStatus.textContent=error.message||'保存失败，未写入';}
    finally{if(alive())save.disabled=false;}
  },'quiet');
  function setCommand(value){input.value=value;invalidateCommand();input.focus?.();}
  function paintSaved(){saved.replaceChildren(...(memory.commandTemplates||[]).map(value=>button(value,()=>setCommand(value),'quiet')));}
  function previewCommand(){
    const q=parseSelectionCommand(input.value);
    if(!q.ok){preview.replaceChildren(note(q.error));return;}
    const day=selectionCommandDay(ctx.state||{});
    const clauses=digits(q.raw).trim().replace(/[。！!？?]+$/g,'').split(/并且|而且|同时|且|[，,；;]/).filter(Boolean);
    const cards=clauses.map((clause,index)=>{
      const editor=h('input',{type:'text','aria-label':'条件 '+(index+1),maxlength:'160'});
      editor.value=clause;
      editor.addEventListener('change',()=>{const next=clauses.slice();next[index]=editor.value;setCommand(next.join('且'));});
      return h('label',{class:'fy-field'},h('span',{},'条件 '+(index+1)),editor);
    });
    preview.replaceChildren(note((day||'交易日未知')+' · '+(q.explicitAllMarket?'全市场未就绪，不执行候选池替代':'当前已接收候选池，非全市场')+
      ' · '+metricNames[q.metric]+'降序 · '+q.days+'个交易日 · 前'+q.limit+'只 · 题材：'+(q.theme||'不限')),
      ...((q.filters||[]).map(f=>h('small',{class:'fy-muted'},f.label))),...cards);
  }
  function invalidateCommand(){generation++;lastQuery=null;run.disabled=false;result.replaceChildren();previewCommand();}

  const form = h('form', {class: 'fy-toolbar', onSubmit: event => {event.preventDefault();submit();}}, input, run);
  const host = h('details', {class: 'fy-details fy-command-selection'}, h('summary', {}, '一句话选股'),
    h('p', {class: 'fy-muted'}, '在已接收候选中排序，可用“且”连接评分、共振、涨幅、换手率、股价、成交额、市值及排除ST/停牌条件。缺少任一条件的依据就不纳入结果。'), form,
    h('div', {class: 'fy-inline'}, ...['近5日主力净流入前5的芯片股', '精选评分前3且涨幅小于5%', '共振分前3且评分至少80'].map(example => button(example, () => setCommand(example), 'quiet')),save,loadTemplates), templateStatus, saved, preview, result);
  let generation = 0, lastQuery = null, history = null, historyAt = 0;
  const alive = () => !ctx.signal?.aborted;
  input.addEventListener('input',invalidateCommand);paintSaved();
  function paint(query) {
    const state = {...(ctx.state || {}), ...(ctx.decisionPools ? {decisionPools: ctx.decisionPools} : {})};
    const value = evaluateSelectionCommand(query, {state, flowContext: history, resonanceByCode: ctx.decisionResonance});
    host.dataset.commandStatus = value.status || 'unsupported';
    if (!value.ok) {result.replaceChildren(note(value.error || value.message));return;}
    result.replaceChildren(note(value.message), h('small', {class: 'fy-muted'}, value.scope + ' · 观察结果，执行仍需原门禁'),
      ...value.items.map(row => h('button', {type: 'button', class: 'fy-stock-card fy-command-stock', 'data-code': row.code, 'data-date': value.day,
        onClick: event => ctx.selectStock(row.code, row, event.currentTarget)},
      h('strong', {}, row.name || row.code), h('small', {}, row.code), h('span', {}, row.selectionWhy))));
  }
  async function submit() {
    const query = parseSelectionCommand(input.value), turn = ++generation;
    run.disabled = false;
    lastQuery = query;previewCommand();
    if (!query.ok || query.explicitAllMarket) {paint(query);return;}
    if ((query.metric === 'resonance'||query.filters?.some(filter=>filter.metric==='resonance')) && !ctx.decisionResonance && ctx.loadDecisionCenter) {
      run.disabled = true;result.replaceChildren(note('正在核对同日策略共振…'));
      try {
        await ctx.loadDecisionCenter();
        if (!alive() || turn !== generation)return;
      } catch (error) {
        if (alive() && turn === generation) {paint(query);result.prepend(note('共振回执读取未完成：' + error.message));}return;
      } finally {if (turn === generation) run.disabled = false;}
    }
    if (query.metric !== 'flow') {paint(query);return;}
    const day = selectionCommandDay(ctx.state || {}), now = Date.now();
    if (!day) {paint(query);return;}
    if (history?.day === day && history.days === query.days && now - historyAt < 60000) {paint(query);return;}
    run.disabled = true;result.replaceChildren(note('正在核对已有逐日资金回执…'));
    try {
      const response = await ctx.api('/api/selection-command/context?days=' + query.days, {signal: ctx.signal});
      if (!alive() || turn !== generation) return;
      if (!response?.ok || response.day !== day) throw Error(response?.error || '资金历史交易日与当前候选不一致。');
      history = response;historyAt = Date.now();paint(query);
    } catch (error) {
      if (!alive() || turn !== generation) return;
      history = null;paint(query);result.prepend(note('资金回执读取未完成：' + error.message));
    } finally {if (turn === generation) run.disabled = false;}
  }
  ctx.onState?.(() => {
    if (!lastQuery?.ok || !alive() || run.disabled) return;
    if (history && history.day !== selectionCommandDay(ctx.state || {})) history = null;
    if(!preview.matches?.(':focus-within'))previewCommand();paint(lastQuery);
  });
  ctx.signal?.addEventListener('abort', () => {generation++;templateTurn++;history = null;}, {once: true});
  return host;
}
