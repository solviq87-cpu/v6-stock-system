/* V6 Studio: read-only consumer of existing authorized V6 endpoints. No forced scan or orders. */
(function(){
  "use strict";
  const $ = id => document.getElementById(id);
  const page = document.body.dataset.page;
  const state = {items:[],rawCount:0,scanned:null,at:null,isSnapshot:false,selected:null,period:"day",
    candles:[],loadId:0,chartId:0,ready:false,wasPartial:false,completeScope:false,scope:""};
  const safe = v => v == null ? "" : String(v).slice(0,450);
  const finite = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim()))) && Number.isFinite(Number(v)) ? Number(v) : null;
  const fmt = (v,d=2) => finite(v) == null ? "—" : Number(v).toLocaleString("zh-CN",{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct = v => finite(v)==null ? "涨跌未知" : (Number(v)>0?"+":"")+fmt(v)+"%";
  const el = (tag,cls,label) => { const node=document.createElement(tag);if(cls)node.className=cls;if(label!=null)node.textContent=label;return node; };
  const set = (id,value) => {const n=$(id);if(n)n.textContent=value==null?"—":String(value);};
  const dateText = v => {
    if(v==null||v==="")return "未提供";
    if(typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v))return v;
    const ms=finite(v),n=ms!=null&&ms>=1e12?ms:null;
    return n!=null?new Date(n).toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"}):"未验证";
  };
  const token = () => {try{return localStorage.getItem("qd_device")||localStorage.getItem("qd_token")||"";}catch{return "";}};
  async function get(url,signal){
    const headers={Accept:"application/json"};
    const t=token();
    // The existing V6 server verifies req.__tok extracted from same-origin URL
    // query (not the Authorization header). Never forward the token off-origin.
    if(t){const u=new URL(url,window.location.origin);if(u.origin!==window.location.origin)throw Error("禁止跨站传递令牌");u.searchParams.set("token",t);url=u.pathname+u.search;}
    const r=await fetch(url,{method:"GET",credentials:"same-origin",cache:"no-store",headers,signal});
    if(!r.ok)throw Error("HTTP "+r.status);
    const d=await r.json();
    if(d&&d.locked===true)throw Error("当前没有候选池查看权限，请在原站完成登录");
    if(d&&d.ok===false){const e=new Error(safe(d.error||d.note||"接口返回不可用"));e.status=d.status||"api-error";throw e;}
    if(d&&(d.isMock===true||d.simulated===true))throw Error("拒绝将模拟数据当成真实命中");
    return d;
  }
  const reasons = item => {
    const result=[],seen=new Set();
    const raw=Array.isArray(item.hit)?item.hit:Array.isArray(item.reasons)?item.reasons:[];
    raw.forEach(x=>{
      const id=x&&typeof x==="object"&&x.id!=null?safe(x.id):"";
      const txt=typeof x==="string"?safe(x):x&&typeof x==="object"?safe(x.text||x.reason):"";
      const label=(id?"条件 "+id+" · ":"")+(txt||"原始命中理由未返回");
      const key=id+"|"+txt;if(seen.has(key))return;seen.add(key);
      if(id||txt)result.push({id,text:label});
    });
    if(!result.length&&Array.isArray(item.hitIds)){
      item.hitIds.forEach(id=>{const t=safe(id);if(!t||seen.has(t+"|"))return;seen.add(t+"|");result.push({id:t,text:"条件 "+t+" · 未返回命中解释"});});
    }
    return result;
  };
  function combine(items){
    const map=new Map(),invalid=[];
    (Array.isArray(items)?items:[]).forEach((item,i)=>{
      if(!item||typeof item!=="object")return;
      const code=safe(item.code||item.symbol).replace(/[^0-9]/g,"").slice(0,6);
      const key=/^\d{6}$/.test(code)?code:"unverified-"+i;
      const incoming=reasons(item);
      let a=map.get(key);
      if(!a){
        a={key,code:/^\d{6}$/.test(code)?code:"",name:safe(item.name||code||"名称待核验"),
          sector:safe(item.sector||""),score:finite(item.score??item.finalScore),
          change:finite(item.pct??item.changePct??item.change),
          price:finite(item.price??item.last??item.close),risk:safe(item.riskStatus||item.risk?.status||item.risk?.level||item.riskLevel||"风险待核验"),
          blocked:item.blocked===true||item.risk?.blocked===true,
          reasons:[],strategies:[],rawSignals:0,quoteAt:item.vendorQuoteAt||item.quoteAt||null};
        map.set(key,a);
      }
      a.rawSignals++;
      if(!a.sector&&item.sector)a.sector=safe(item.sector);
      if(a.score==null)a.score=finite(item.score??item.finalScore);
      if(a.change==null)a.change=finite(item.pct??item.changePct??item.change);
      if(a.price==null)a.price=finite(item.price??item.last??item.close);
      if(item.blocked===true||item.risk?.blocked===true)a.blocked=true;
      const strategy=safe(item.strategyName||item.strategy||"");
      if(strategy&&!a.strategies.includes(strategy))a.strategies.push(strategy);
      incoming.forEach(x=>{if(!a.reasons.some(y=>y.id===x.id&&y.text===x.text))a.reasons.push(x);});
    });
    return [...map.values()];
  }
  const notify=(message,kind)=>{
    const n=$("source-alert");if(!n)return;
    n.className="alert"+(kind==="error"?" error":"");
    n.textContent=message;
  };
  function completeness(data){
    const raw=Array.isArray(data.items)?data.items.length:0;
    const declared=finite(data.totalStocks??data.count),scanned=finite(data.totalScanned);
    state.rawCount=raw;state.scanned=scanned;state.at=data.snapshotDay||data.tradeDate||data.date||data.asOf||null;
    state.isSnapshot=data.isSnapshot===true;state.completeScope=data.fullyRead===true;
    state.scope=safe(data.scope||"");
    state.wasPartial=!state.completeScope;
    const intro="当前读取 "+raw+" 条源记录，合并同股后 "+state.items.length+" 只。";
    const note=state.completeScope
      ?"六项量化条件的整份扫描快照已按游标全部读取并核对数量；但其他四套策略及额外战法仍待统一汇入。"
      :"当前仅显示旧接口实际返回的候选，受旧接口最多50只的限制，不能称为全市场全部命中。";
    notify(intro+note+" 未认证实时行情；页面翻页不重算、不下单。");
    set("count-matches",state.items.length);
    set("count-signals",state.items.reduce((n,x)=>n+x.reasons.length,0));
    set("count-scanned",scanned==null?"未提供":fmt(scanned,0));
    set("count-snapshot",dateText(state.at));
    set("all-matches-warning",state.completeScope?"六条件快照已完整读取 · 其他策略待接入":"候选尚不完整 · 仅显示已返回数据");
    set("summary-count",state.items.length);
  }
  function filters(){
    const choice=$("filter-rule");if(!choice)return;
    const prior=choice.value;choice.replaceChildren(new Option("所有命中规则","all"));
    const ids=new Set();
    state.items.forEach(x=>x.reasons.forEach(y=>{if(y.id)ids.add(y.id);}));
    [...ids].sort((a,b)=>a.localeCompare(b,"zh-CN",{numeric:true})).forEach(id=>choice.add(new Option("条件 "+id,id)));
    if([...choice.options].some(o=>o.value===prior))choice.value=prior;
  }
  function filtered(){
    const q=safe($("search-stock")?.value||"").trim().toLowerCase();
    const rule=$("filter-rule")?.value||"all";
    const board=$("filter-board")?.value||"all";
    const sort=$("sort-stock")?.value||"score";
    const risk=$("filter-risk")?.value||"all";
    const rows=state.items.filter(x=>{
      if(q&&![x.name,x.code,x.sector,x.strategies.join(" "),x.reasons.map(y=>y.text).join(" ")].join(" ").toLowerCase().includes(q))return false;
      if(rule!=="all"&&!x.reasons.some(y=>y.id===rule))return false;
      if(board==="main"&& !/^(60|00)/.test(x.code))return false;
      if(board==="gem"&& !/^(30|68)/.test(x.code))return false;
      if(risk==="blocked"&&!x.blocked)return false;
      if(risk==="other"&&x.blocked)return false;
      return true;
    });
    rows.sort((a,b)=>{
      if(sort==="signals")return b.reasons.length-a.reasons.length||a.code.localeCompare(b.code);
      if(sort==="change")return (b.change??-Infinity)-(a.change??-Infinity);
      if(sort==="name")return a.code.localeCompare(b.code);
      return (b.score??-Infinity)-(a.score??-Infinity)||b.reasons.length-a.reasons.length;
    });
    return rows;
  }
  function stockCard(x){
    const btn=el("button","stock"+(state.selected===x.key?" selected":""));btn.type="button";btn.dataset.stock=x.key;
    const head=el("div","stock-head");const title=el("h3","",x.name);
    title.append(el("span","stock-code",x.code||"代码待核验"));
    head.append(title,el("span","stock-score",x.score==null?"评分待返回":fmt(x.score,1)+" 分"));
    const meta=el("div","stock-meta");
    [x.sector||"板块未核验",pct(x.change),"命中 "+x.reasons.length+" 条条件",x.blocked?"风险阻断":x.risk].forEach(t=>meta.append(el("span","",t)));
    const tags=el("div","reasons");
    (x.reasons.length?x.reasons.slice(0,5).map(z=>z.text):["命中理由未返回"]).forEach(t=>tags.append(el("span","",t)));
    if(x.reasons.length>5)tags.append(el("span","","其余 "+(x.reasons.length-5)+" 条详见右侧"));
    btn.append(head,meta,tags);
    btn.addEventListener("click",()=>selectStock(x.key));
    return btn;
  }
  function render(){
    const container=$("stock-list");if(!container)return;
    const rows=filtered();set("visible-count",rows.length);
    container.replaceChildren();
    if(!rows.length){container.append(el("div","empty",state.ready?"当前筛选下没有候选，试试清除筛选。":"等待已验证的候选数据"));return;}
    const frag=document.createDocumentFragment();
    rows.forEach(x=>frag.append(stockCard(x)));container.append(frag);
    if(!state.selected&&rows.length)selectStock(rows[0].key,false);
  }
  function selectStock(key,scroll=true){
    state.selected=key;const x=state.items.find(z=>z.key===key);if(!x)return;
    document.querySelectorAll(".stock").forEach(n=>n.classList.toggle("selected",n.dataset.stock===key));
    const panel=$("detail-panel");if(!panel)return;
    panel.replaceChildren();
    const kicker=el("div","kicker","股票研究档案 · 原始命中证据");
    const heading=el("h2","",x.name+" "+(x.code||""));
    const tag=el("div","reasons");
    [x.sector||"板块未知",x.score==null?"评分未提供":"综合分 "+fmt(x.score,1),x.blocked?"存在风险阻断":x.risk].forEach(t=>tag.append(el("span","",t)));
    const title=el("h3","","全部命中理由（"+x.reasons.length+"）");
    title.style.marginTop="25px";
    const ul=el("ul","evidence");
    if(!x.reasons.length)ul.append(el("li","","接口未提供可确认的完整命中条件"));
    x.reasons.forEach(r=>ul.append(el("li","",r.text)));
    const dl=el("dl");
    [["价格",fmt(x.price)],["涨跌",pct(x.change)],["策略归属",x.strategies.join("、")||"待后端明确归属"],
      ["逐票报价时点",x.quoteAt?dateText(x.quoteAt):"未知，非实时认证"],
      ["重复信号记录",x.rawSignals+" 条源记录"],["数据快照",dateText(state.at)]].forEach(row=>{dl.append(el("dt","",row[0]),el("dd","",row[1]));});
    const subtitle=el("h3","","历史K线 · 仅显示真实返回日线");
    const periods=el("div","periods");
    [["day","日K"],["month","月K"],["year","年K"]].forEach(pair=>{
      const b=el("button","",pair[1]);b.type="button";b.setAttribute("aria-pressed",String(state.period===pair[0]));
      b.addEventListener("click",()=>{state.period=pair[0];periods.querySelectorAll("button").forEach(t=>t.setAttribute("aria-pressed",String(t===b)));drawChart();});
      periods.append(b);
    });
    const chart=el("div","chart","正在读取历史K线…");chart.id="real-chart";
    const chartNote=el("p","note","历史数据按返回的交易日聚合，不补齐缺失日期，不代表实时报价。");chartNote.id="chart-caption";
    const research=el("a","outline","打开完整策略研究");
    research.href="/research.html#decisionWorkspace";research.style.display="inline-block";research.style.marginTop="14px";
    panel.append(kicker,heading,tag,title,ul,dl,subtitle,periods,chart,chartNote,research);
    state.candles=[];const seq=++state.chartId;
    if(x.code)loadKline(x.code,seq);else chart.textContent="股票代码未核验，无法请求K线";
    if(scroll&&window.matchMedia("(max-width:1160px)").matches)panel.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function rowsValid(rows){
    const map=new Map();
    (Array.isArray(rows)?rows:[]).forEach(r=>{
      if(!r||!/^\d{4}-\d\d-\d\d$/.test(String(r.date||"")))return;
      const o=finite(r.open),h=finite(r.high),l=finite(r.low),c=finite(r.close);
      if([o,h,l,c].some(n=>n==null||n<=0)||h<Math.max(o,c,l)||l>Math.min(o,c,h))return;
      map.set(r.date,{date:r.date,open:o,high:h,low:l,close:c,volume:finite(r.volume)});
    });
    return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function aggregate(rows,mode){
    if(mode==="day")return rows;
    const group=new Map();
    rows.forEach(r=>{
      const key=mode==="year"?r.date.slice(0,4):r.date.slice(0,7);
      if(!group.has(key))group.set(key,{...r});
      else{const v=group.get(key);v.date=r.date;v.high=Math.max(v.high,r.high);v.low=Math.min(v.low,r.low);v.close=r.close;v.volume=v.volume==null||r.volume==null?null:v.volume+r.volume;}
    });
    return [...group.values()];
  }
  async function loadKline(code,seq){
    try{
      const data=await get("/api/kline?code="+encodeURIComponent(code)+"&n=1200");
      if(seq!==state.chartId)return;
      state.candles=rowsValid(data.rows);drawChart();
    }catch(err){if(seq!==state.chartId)return;const c=$("real-chart");if(c)c.textContent="K线不可用："+safe(err.message);}
  }
  function drawChart(){
    const canvas=$("real-chart"),note=$("chart-caption");if(!canvas)return;
    const all=aggregate(state.candles,state.period);
    if(!all.length){canvas.textContent="没有可核验的历史K线";if(note)note.textContent="只显示服务端返回的有效OHLC，不生成模拟K线";return;}
    const plot=all.slice(-45),values=plot.flatMap(r=>[r.high,r.low]);
    const min=Math.min(...values),max=Math.max(...values),spread=Math.max(.01,max-min);
    const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
    const W=620,H=240,pad=19;svg.setAttribute("viewBox","0 0 "+W+" "+H);
    svg.setAttribute("role","img");svg.setAttribute("aria-label","来源于已返回历史行情的"+(state.period==="day"?"日":"聚合")+"K线");
    for(let j=0;j<4;j++){const line=document.createElementNS(ns,"line"),y=pad+j*(H-2*pad)/3;["x1","y1","x2","y2","stroke"].forEach((k,i)=>line.setAttribute(k,[0,y,W,y,"#e4e9df"][i]));svg.append(line);}
    const y=v=>H-pad-(v-min)/spread*(H-2*pad),step=(W-2*pad)/plot.length;
    plot.forEach((r,i)=>{
      const x=pad+(i+.5)*step,col=r.close>=r.open?"#b65348":"#187e63";
      const wick=document.createElementNS(ns,"line");
      [["x1",x],["x2",x],["y1",y(r.high)],["y2",y(r.low)],["stroke",col],["stroke-width",1.4]].forEach(z=>wick.setAttribute(z[0],z[1]));svg.append(wick);
      const rect=document.createElementNS(ns,"rect");
      [["x",x-step*.31],["y",Math.min(y(r.open),y(r.close))],["width",Math.max(2,step*.62)],["height",Math.max(1,Math.abs(y(r.open)-y(r.close)))],["rx",1],["fill",col]].forEach(z=>rect.setAttribute(z[0],z[1]));svg.append(rect);
    });
    canvas.replaceChildren(svg);
    if(note)note.textContent=(state.period==="day"?"日K":state.period==="month"?"月K（真实日线按自然月聚合）":"年K（真实日线按公历年聚合）")+" · "+all.length+" 个有效周期，图中最近 "+plot.length+" 根 · 截止 "+all.at(-1).date+" · 最近周期可能未结束";
  }
  // Pin every page to one immutable server snapshot. Never mix a changed
  // snapshot into partial results; the server must identify total coverage.
  async function readAllSixRulePages(){
    let cursor="",snapshotId="",total=null,asOf=null,totalScanned=null,totalSignals=null;
    const all=[],seenCursors=new Set();
    for(let n=0;n<81;n++){
      if(n===80)throw Error("分页超过安全上限，拒绝显示不完整结果");
      const endpoint="/api/v6/matches?limit=100"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
      const d=await get(endpoint);
      if(d.scope!=="quant-picks-six-rules"||d.completeForScope!==true)
        throw Error("后端尚未确认量化六条件的完整快照");
      if(!Array.isArray(d.items)||!Number.isSafeInteger(d.totalStocks)||d.totalStocks<0||
         d.totalStocks>8000||!Number.isSafeInteger(d.offset)||d.offset!==all.length||
         typeof d.snapshotId!=="string"||!/^[0-9a-f]{24}$/.test(d.snapshotId))
        throw Error("分页快照元数据无效，已拒绝混合不同批次");
      if(snapshotId&&d.snapshotId!==snapshotId)throw Error("读取过程中快照发生变化，请重新读取");
      if(total!==null&&d.totalStocks!==total)throw Error("快照总数变化");
      snapshotId=d.snapshotId;total=d.totalStocks;
      asOf=d.asOf;totalScanned=d.totalScanned;totalSignals=d.totalSignals;
      all.push(...d.items);
      if(!d.hasMore){
        if(d.nextCursor!==null||all.length!==total)throw Error("分页终止状态与候选总数不一致");
        const actualSignals=all.reduce((sum,x)=>sum+(Array.isArray(x.hit)?x.hit.length:0),0);
        if(actualSignals!==totalSignals)throw Error("服务端命中条件总数与逐页内容不一致");
        return {items:all,count:all.length,totalStocks:total,totalScanned,totalSignals,
          asOf,scope:"quant-picks-six-rules",fullyRead:true,snapshotId};
      }
      if(!d.nextCursor||typeof d.nextCursor!=="string"||seenCursors.has(d.nextCursor)||all.length>=total)
        throw Error("分页游标损坏、重复或提前结束");
      seenCursors.add(d.nextCursor);
      cursor=d.nextCursor;
    }
    throw Error("分页流程未正确结束");
  }
  async function load(){
    const seq=++state.loadId,button=$("refresh-all");if(button)button.disabled=true;
    notify("正在核对 V6 的全量快照及全部命中条件…");
    try{
      let d,legacy=null;
      try{d=await readAllSixRulePages();}
      catch(firstError){
        if(firstError.status==="not-ready"){
          // A single ordinary cached GET may initialize the existing scan.
          // Never use force=1, POST, or a new browser-owned scanner.
          legacy=await get("/api/quant-picks?board=all&max=50");
          try{d=await readAllSixRulePages();}
          catch(secondError){
            if(secondError.status!=="not-ready")throw secondError;
            d=legacy; // Explicitly labelled partial in completeness().
          }
        }else throw firstError;
      }
      if(seq!==state.loadId)return;
      if(!Array.isArray(d.items))throw Error("接口没有返回合法候选列表");
      state.items=combine(d.items);state.ready=true;
      completeness(d);filters();render();
    }catch(err){
      if(seq!==state.loadId)return;
      if(!state.ready){state.items=[];render();}
      notify((state.ready?"刷新失败，暂时保留先前已核验结果（非实时）。":"当前无法取得可核验的候选。")+" "+safe(err.message),"error");
    }finally{if(seq===state.loadId&&button)button.disabled=false;}
  }
  async function loadToday(){
    try{
      const [m,i,s]=await Promise.allSettled([get("/api/mobile-digest"),get("/api/reference-indexes"),get("/api/reference-strategy-stats")]);
      if(m.status==="fulfilled"){
        const d=m.value,mood=d.mood||{};
        if(d.isMock!==true&&d.simulated!==true){
          set("market-view",safe(mood.verdict||mood.advice||"等待证据"));
          set("market-reason",safe(mood.why||mood.note||"行情来源与市场广度需要验证"));
          set("zt-view",d.ztPool?.count==null?"未返回":d.ztPool.count);
          set("market-fresh",d.isSnapshot?"历史快照 "+safe(d.snapshotDay||""):d.ready===true?"服务端已响应（未认证实时）":"数据未就绪");
        }
      }
      if(i.status==="fulfilled"&&i.value.ok===true){
        const labels={sh:"sh",sz:"sz",cyb:"cyb",kc50:"kc50"};
        Object.keys(labels).forEach(key=>{
          const p=i.value.items?.[key];
          if(p&&finite(p.price)!=null&&finite(p.price)>0){
            set("index-"+key,fmt(p.price));
            set("indexpct-"+key,pct(p.changePct));
          }
        });
      }
      if(s.status==="fulfilled"&&s.value.ok===true){
        const strategy=s.value.items||{};
        ["rule14","bazi","gpt","python"].forEach(key=>{
          const item=strategy[key];
          set("strategy-"+key,item?.status==="attributed"&&finite(item.count)!=null?fmt(item.count,0)+" 只":"待归因");
        });
      }
    }catch{}
  }
  function init(){
    ["search-stock","filter-rule","filter-board","filter-risk","sort-stock"].forEach(id=>{
      const n=$(id);if(n)n.addEventListener(id==="search-stock"?"input":"change",render);
    });
    if($("refresh-all"))$("refresh-all").addEventListener("click",()=>{load();if(page==="studio")loadToday();});
    if($("clear-filters"))$("clear-filters").addEventListener("click",()=>{
      if($("search-stock"))$("search-stock").value="";
      ["filter-rule","filter-board","filter-risk"].forEach(id=>{if($(id))$(id).value="all";});
      if($("sort-stock"))$("sort-stock").value="score";render();
    });
    load();if(page==="studio")loadToday();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();