'use strict';
// A research projection of evidence frozen with one analysis. Fractions, not percent.
const finite = x => typeof x === 'number' && Number.isFinite(x);
const time = x => Number.isSafeInteger(x) && x > 0;
const symbolOK = x => typeof x === 'string' && /^\d{6}$/.test(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 120;
const day = t => new Date(t + 28800000).toISOString().slice(0, 10);
const list = x => Array.isArray(x) ? x : [];
const validDate = x => typeof x === 'string' && /^\d{4}-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
// Bound inputs so sums of 5,000 rows and index-point products stay finite.
const optionalNumber = x => x == null || finite(x) && Math.abs(x) <= 1e100;
const known = (t, cutoff) => time(t) && t <= cutoff;
const keys = (x, allowed) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => allowed.includes(k));
const unique = xs => new Set(xs).size === xs.length;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const round = x => finite(x) ? Number(x.toFixed(10)) : null;
function normalizeMarketLinkageEvidence(input, {asOf, tradeDate, provider, symbol} = {}) {
 if (input == null) return null;
 const fail = () => { throw Error('联动证据身份、时间或字段无效'); };
 if (!input || typeof input !== 'object' || !time(asOf) || !validDate(tradeDate) || !text(provider) || !symbolOK(symbol) || input.provider !== provider || input.symbol !== symbol || input.tradeDate !== tradeDate || !known(input.knownAt, asOf)) fail();
 if (!keys(input,['provider','symbol','tradeDate','knownAt','window','returnBasis','benchmark','classification','methodology','boards','stocks'])) fail();
 try { if (Buffer.byteLength(JSON.stringify(input)) > 100000) fail(); } catch { fail(); }
 const {window:w, benchmark:b, classification:c, methodology:m} = input;
 if (!keys(w,['start','end']) || !keys(b,['provider','code','name','methodologyVersion','return','startValue','knownAt']) || !keys(c,['provider','version','knownAt','effectiveAt']) || !keys(m,['weightsKnownAt','weightsEffectiveAt','noCorporateActions','completeConstituents'])) fail();
 if (!w || !time(w.start) || !time(w.end) || w.start >= w.end || w.end > asOf || day(w.end) !== tradeDate || input.knownAt < w.end || !['price','unadjusted','price-return','total-return'].includes(input.returnBasis)) fail();
 if (!b || b.provider !== provider || !text(b.code) || !text(b.name) || b.methodologyVersion != null && !text(b.methodologyVersion) || !known(b.knownAt, input.knownAt) || b.knownAt < w.end || !optionalNumber(b.return) || b.return != null && b.return < -1 || !optionalNumber(b.startValue) || b.startValue != null && b.startValue <= 0) fail();
 if (!c || c.provider !== provider || !text(c.version) || !known(c.knownAt, w.start) || !time(c.effectiveAt) || c.effectiveAt > w.start) fail();
 if (!m || !Array.isArray(input.boards) || input.boards.length > 100 || !Array.isArray(input.stocks) || input.stocks.length > 5000) fail();
 if (m.weightsKnownAt != null && !known(m.weightsKnownAt, w.start) || m.weightsEffectiveAt != null && (!time(m.weightsEffectiveAt) || m.weightsEffectiveAt > w.start) || ![true,false,null,undefined].includes(m.noCorporateActions) || ![true,false,null,undefined].includes(m.completeConstituents)) fail();
 const boardKeys = [], stockKeys = [];
 for (const board of input.boards) {
  if (!keys(board,['code','name','category','members','membersKnownAt','membersEffectiveAt','return','knownAt']) || !text(board.code) || !text(board.name) || !['industry','concept'].includes(board.category) || !Array.isArray(board.members) || board.members.length > 5000 || !board.members.every(symbolOK) || !unique(board.members) || !known(board.membersKnownAt, w.start) || !time(board.membersEffectiveAt) || board.membersEffectiveAt > w.start || !known(board.knownAt, input.knownAt) || board.knownAt < w.end || !optionalNumber(board.return) || board.return != null && board.return < -1) fail();
  boardKeys.push(board.category + ':' + board.code);
 }
 if (!unique(boardKeys)) fail();
 for (const s of input.stocks) {
  if (!keys(s,['symbol','return','weight','indexMember','primaryIndustry','turnover','knownAt','activation']) || !symbolOK(s.symbol) || !known(s.knownAt, input.knownAt) || s.knownAt < w.end || !optionalNumber(s.return) || s.return != null && s.return < -1 || !optionalNumber(s.weight) || s.weight != null && (s.weight < 0 || s.weight > 1) || !optionalNumber(s.turnover) || s.turnover != null && s.turnover < 0 || ![true,false,null,undefined].includes(s.indexMember) || s.primaryIndustry != null && !text(s.primaryIndustry)) fail();
  if (s.activation != null) {const a=s.activation; if (!keys(a,['at','confirmedAt','knownAt','definitionVersion']) || !time(a.at) || a.at < w.start || a.at > w.end || !time(a.confirmedAt) || a.confirmedAt < a.at || a.confirmedAt > w.end || !known(a.knownAt,input.knownAt) || a.knownAt < a.confirmedAt || !text(a.definitionVersion)) fail();}
  if (s.weight != null && (s.indexMember !== true || !known(m.weightsKnownAt, w.start) || !time(m.weightsEffectiveAt))) fail();
  const industries = input.boards.filter(bd => bd.category === 'industry' && bd.members.includes(s.symbol));
  if (industries.length > 1 || s.primaryIndustry != null && (industries.length !== 1 || industries[0].code !== s.primaryIndustry)) fail();
  stockKeys.push(s.symbol);
 }
 if (!unique(stockKeys) || sum(input.stocks.map(s => s.weight || 0)) > 1.000001) fail();
 // Copy a bounded, explicitly enumerated contract; no arbitrary caller fields survive.
 return {provider, symbol, tradeDate, knownAt:input.knownAt, window:{start:w.start,end:w.end}, returnBasis:input.returnBasis,
  benchmark:{provider,code:b.code,name:b.name,methodologyVersion:b.methodologyVersion ?? null,return:b.return ?? null,startValue:b.startValue ?? null,knownAt:b.knownAt},
  classification:{provider,version:c.version,knownAt:c.knownAt,effectiveAt:c.effectiveAt},
  methodology:{weightsKnownAt:m.weightsKnownAt ?? null,weightsEffectiveAt:m.weightsEffectiveAt ?? null,noCorporateActions:m.noCorporateActions ?? null,completeConstituents:m.completeConstituents ?? null},
  boards:input.boards.map(q => ({code:q.code,name:q.name,category:q.category,members:[...q.members],membersKnownAt:q.membersKnownAt,membersEffectiveAt:q.membersEffectiveAt,return:q.return ?? null,knownAt:q.knownAt})),
  stocks:input.stocks.map(s => ({symbol:s.symbol,return:s.return ?? null,weight:s.weight ?? null,indexMember:s.indexMember ?? null,primaryIndustry:s.primaryIndustry ?? null,turnover:s.turnover ?? null,knownAt:s.knownAt,activation:s.activation ? {at:s.activation.at,confirmedAt:s.activation.confirmedAt,knownAt:s.activation.knownAt,definitionVersion:s.activation.definitionVersion} : null}))};
}
function boardView(board, stocks, benchmarkReturn, symbol) {
 const members = board.members.map(code => stocks.get(code)).filter(Boolean).filter(s => finite(s.return));
 const values = members.map(s => s.return), up = values.filter(x=>x>0).length, down = values.filter(x=>x<0).length, flat = values.length-up-down;
 const positive = values.filter(x=>x>0).sort((a,b)=>b-a), positiveSum = sum(positive), coverage = board.members.length ? values.length/board.members.length : null;
 const ranked = [...members].sort((a,b)=>b.return-a.return || a.symbol.localeCompare(b.symbol));
 // Rank each distinct value once; a large board must not scan every peer per row.
 const ranks=new Map();ranked.forEach((s,i)=>{if(!ranks.has(s.return))ranks.set(s.return,i+1);});
 const own = ranked.find(s=>s.symbol===symbol), rank = own ? ranks.get(own.return) : null;
 const eligible = ranked.length >= 5 && coverage >= .8;
 const role = !eligible || !rank ? 'unknown' : rank <= Math.ceil(ranked.length*.2) ? 'relative-front' : rank > ranked.length*.8 ? 'relative-back' : 'relative-middle';
 const activations=board.members.map(code=>stocks.get(code)).filter(s=>s?.activation);
 const definitions=new Set(activations.map(s=>s.activation.definitionVersion));
 const activationEligible=board.members.length>=5 && activations.length>=5 && activations.length/board.members.length>=.8 && definitions.size===1;
 const first=activationEligible?Math.min(...activations.map(s=>s.activation.at)):null;
 const firstCount=activations.filter(x=>x.activation.at===first).length;
 const leadFollow=s=>!activationEligible||!s?.activation?'unknown':s.activation.at===first?(firstCount>1?'tied-first':'observed-first'):'observed-after';
 const turnovers = members.filter(s=>finite(s.turnover)).sort((a,b)=>b.turnover-a.turnover),ownTurn = turnovers.find(s=>s.symbol===symbol),turnRanks=new Map();turnovers.forEach((s,i)=>{if(!turnRanks.has(s.turnover))turnRanks.set(s.turnover,i+1);});
 const turnoverRole = eligible && turnovers.length >= 5 && turnovers.length / board.members.length >= .8 && ownTurn && turnRanks.get(ownTurn.turnover) <= Math.ceil(turnovers.length*.2) ? 'turnover-core' : 'unknown';
 return {code:board.code,name:board.name,category:board.category,return:board.return,relativeReturn:finite(board.return)&&finite(benchmarkReturn)?round(board.return-benchmarkReturn):null,
  memberCount:board.members.length,members:board.members.map(code=>{const s=stocks.get(code), r=s&&finite(s.return)?ranks.get(s.return):null, tr=s&&finite(s.turnover)?turnRanks.get(s.turnover):null;return {symbol:code,return:s?.return ?? null,relativeReturn:s&&finite(s.return)&&finite(board.return)?round(s.return-board.return):null,rank:eligible?r:null,sampleSize:ranked.length,role:!eligible||!r?'unknown':r<=Math.ceil(ranked.length*.2)?'relative-front':r>ranked.length*.8?'relative-back':'relative-middle',turnoverRole:eligible&&turnovers.length>=5&&turnovers.length/board.members.length>=.8&&tr&&tr<=Math.ceil(turnovers.length*.2)?'turnover-core':'unknown',leadFollow:leadFollow(s),activation:s?.activation ?? null};}),
  breadth:{up,down,flat,missing:board.members.length-values.length,coverage:round(coverage)}, concentration:positiveSum>0?round(sum(positive.slice(0,2))/positiveSum):null,
  stock:{symbol,return:own?.return ?? null,relativeReturn:own&&finite(board.return)?round(own.return-board.return):null,rank:eligible?rank:null,sampleSize:ranked.length,role,turnoverRole,leadFollow:leadFollow(own),activation:own?.activation ?? null}};
}
function attribution(e) {
 const weighted=e.stocks.filter(s=>s.indexMember===true && finite(s.weight)), covered=weighted.filter(s=>finite(s.return));
 const coverageWeight=sum(covered.map(s=>s.weight)), contribution=covered.length?sum(covered.map(s=>s.weight*s.return)):null;
 const points=finite(contribution)&&finite(e.benchmark.startValue)?contribution*e.benchmark.startValue:null;
 const residual=finite(contribution)&&finite(e.benchmark.return)?e.benchmark.return-contribution:null;
 const industries=e.boards.filter(b=>b.category==='industry').map(b=>{const rows=covered.filter(s=>s.primaryIndustry===b.code);const value=rows.length?sum(rows.map(s=>s.weight*s.return)):null;return {code:b.code,name:b.name,contribution:round(value),points:round(finite(value)&&finite(e.benchmark.startValue)?value*e.benchmark.startValue:null)};});
 const unassigned=covered.filter(s=>s.primaryIndustry==null), unknownIndustryContribution=covered.length?sum(unassigned.map(s=>s.weight*s.return)):null;
 const full=e.methodology.completeConstituents===true && e.methodology.noCorporateActions===true && e.stocks.every(s=>s.indexMember===false || s.indexMember===true&&finite(s.weight)&&finite(s.return)) && Math.abs(coverageWeight-1)<=1e-6 && finite(residual) && Math.abs(residual)<=1e-6;
 return {status:!covered.length?'unknown':full?'method-compatible-unverified':'partial-estimate',coverageWeight:covered.length?round(coverageWeight):null,knownContribution:round(contribution),contributionPoints:round(points),residualReturn:round(residual),residualPoints:round(finite(residual)&&finite(e.benchmark.startValue)?residual*e.benchmark.startValue:null),industries,unknownIndustryContribution:round(unknownIndustryContribution)};
}
function fallback(data, events, selected, cutoff) {
 const boards=list(data.context?.sectorContext?.current?.boards), stocks=new Map(), ownDates=list(data.tradeDates);
 for (const event of events) {
  const d=event?.data;
  if (event?.kind!=='analysis' || !d || !time(event.recordedAt) || !known(d.asOf, cutoff) || event.recordedAt>selected.recordedAt || (Number.isSafeInteger(selected.sequence) && (!Number.isSafeInteger(event.sequence)||event.sequence>selected.sequence)) || d.tradeDate!==data.tradeDate || d.provider!==data.provider || d.priceBasis!==data.priceBasis || d.asOf!==data.asOf) continue;
  const bars=list(d.bars), last=bars.at(-1), previous=bars.at(-2), idx=ownDates.indexOf(data.tradeDate);
  if (!last || !previous || idx<1 || last.date!==data.tradeDate || previous.date!==ownDates[idx-1] || !known(last.knownAt,cutoff) || !known(previous.knownAt,cutoff) || !finite(last.close) || !finite(previous.close) || previous.close<=0 || last.suspended || last.corporateAction !== false || !known(last.corporateActionKnownAt,cutoff)) continue;
  const stockReturn=last.close/previous.close-1;
  if (finite(stockReturn) && Math.abs(stockReturn)<=1e100) stocks.set(d.symbol,{symbol:d.symbol,return:stockReturn,turnover:null});
 }
 const valid=boards.filter(b=>b.membershipComplete===true && Array.isArray(b.members) && b.members.length && b.members.length<=5000 && unique(b.members) && b.members.every(symbolOK) && b.quoteDate===data.tradeDate && known(b.quoteAt,cutoff) && day(b.quoteAt)===data.tradeDate && b.quoteAt===Date.parse(data.tradeDate+'T15:00:00+08:00') && known(b.membersObservedAt,cutoff));
 return valid.map(b=>({...boardView({code:b.code,name:b.name,category:b.category,members:b.members,return:null},stocks,null,data.symbol),return:finite(b.changePct)?b.changePct/100:null,comparisonStatus:'cross-provider-window-unverified'}));
}
function buildMarketSectorStockLinkage(events, {selectedEvent, asOf} = {}) {
 const d=selectedEvent?.data, cutoff=time(asOf)&&time(d?.asOf)?Math.min(asOf,d.asOf):0;
 const out={status:'unknown',sourceRunId:selectedEvent?.hash ?? null,tradeDate:d?.tradeDate ?? null,asOf:d?.asOf ?? null,symbol:d?.symbol ?? null,source:null,benchmark:null,window:null,attribution:{status:'unknown',coverageWeight:null,knownContribution:null,contributionPoints:null,residualReturn:null,residualPoints:null,industries:[],unknownIndustryContribution:null},boards:[],unknownReasons:[],researchOnly:true,verified:false};
 if (!d || selectedEvent.kind!=='analysis' || !known(selectedEvent.recordedAt,asOf) || !known(d.asOf,asOf)) {out.unknownReasons.push('selected-event-not-available');return out;}
 let e;
 try {e=normalizeMarketLinkageEvidence(d.context?.marketLinkageEvidence,{asOf:cutoff,tradeDate:d.tradeDate,provider:d.provider,symbol:d.symbol});} catch {out.unknownReasons.push('invalid-frozen-linkage-evidence');return out;}
 if (!e) {
  out.boards=fallback(d,list(events),selectedEvent,cutoff);
  const ix=d.context?.indices, received=typeof ix?.retrievedAt==='string'?Date.parse(ix.retrievedAt):ix?.retrievedAt, row=list(ix?.records).find(r=>r.tradeDate===d.tradeDate);
  if (text(ix?.source) && known(received,cutoff) && row && (finite(row.shanghaiClose)||finite(row.shanghaiChangePct))) out.benchmark={provider:ix.source,code:'000001',name:'上证指数',return:null,startValue:null,close:finite(row.shanghaiClose)?row.shanghaiClose:null,changePct:finite(row.shanghaiChangePct)?row.shanghaiChangePct:null,tradeDate:d.tradeDate,knownAt:received,sourceTimestamp:null,comparisonStatus:'window-and-basis-unknown'};
  out.status=out.boards.length||out.benchmark?'observed-unverified':'unknown';
  out.unknownReasons.push('benchmark-window-and-index-weights-unavailable','board-stock-feed-comparability-unverified','intraday-lead-follow-unavailable','history-not-verified');return out;
 }
 const stocks=new Map(e.stocks.map(s=>[s.symbol,s]));out.source=e.provider;out.benchmark=e.benchmark;out.window=e.window;out.returnBasis=e.returnBasis;out.classification=e.classification;
 out.boards=e.boards.map(b=>boardView(b,stocks,e.benchmark.return,e.symbol));out.attribution=attribution(e);out.status='observed-unverified';
 if (out.attribution.status!=='method-compatible-unverified') out.unknownReasons.push('index-attribution-incomplete-or-unreconciled');
 if (!out.boards.length) out.unknownReasons.push('stock-board-membership-unavailable');
 if (!out.boards.some(b=>b.members.some(m=>m.leadFollow!=='unknown'))) out.unknownReasons.push('intraday-lead-follow-unavailable');
 out.unknownReasons.push('history-not-verified','provider-evidence-not-authenticated');return out;
}
module.exports={normalizeMarketLinkageEvidence,buildMarketSectorStockLinkage};
