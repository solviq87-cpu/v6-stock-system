/* Six historical daily-K patterns; descriptive preview only, never trade authority. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.V6PatternPreview=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasNumber=n=>typeof n==='number'&&Number.isFinite(n);
  const validBar=b=>b&&['open','high','low','close','volume'].every(k=>hasNumber(b[k]))&&
    b.low>0&&Number.isSafeInteger(b.volume)&&b.volume>=0&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close)&&
    (b.amount===undefined||(hasNumber(b.amount)&&b.amount>=0));
  const body=b=>Math.abs(b.close-b.open),range=b=>b.high-b.low;
  const up=b=>b.close>b.open&&range(b)>0,down=b=>b.close<b.open&&range(b)>0;
  const bodyFraction=b=>range(b)>0?body(b)/range(b):0;
  const lower=b=>Math.min(b.open,b.close)-b.low,upper=b=>b.high-Math.max(b.open,b.close);
  function evaluate(rows){
    const empty={usable:false,reason:'K线数据不足或字段不完整',checks:[],positive:[],risks:[]};
    if(!Array.isArray(rows)||rows.length<3||rows.length>5000||!rows.every(validBar))return empty;
    if(!rows.every((b,i)=>{const d=String(b.date||'');const millis=/^\d{4}-\d{2}-\d{2}$/.test(d)?Date.parse(d+'T00:00:00Z'):NaN;
      return Number.isFinite(millis)&&new Date(millis).toISOString().slice(0,10)===d&&
        (i===0||d>rows[i-1].date);
    }))return {...empty,reason:'交易日期缺失、重复或排序异常'};
    const n=rows.length,a=rows[n-3],b=rows[n-2],c=rows[n-1];
    const checks=[];
    function record(id,label,side,needed,hit,detail){
      checks.push({id,label,side,needed,status:n<needed?'insufficient_data':hit?'matched':'not_matched',detail});
    }
    const soldiers=[a,b,c].every(v=>up(v)&&bodyFraction(v)>=.45&&upper(v)<=Math.max(body(v)*.7,.001))&&
      a.close<b.close&&b.close<c.close&&a.low<=b.low&&b.low<=c.low;
    const crows=[a,b,c].every(v=>down(v)&&bodyFraction(v)>=.45&&lower(v)<=Math.max(body(v)*.7,.001))&&
      a.close>b.close&&b.close>c.close&&a.high>=b.high&&b.high>=c.high;
    record('red_three_soldiers','红三兵','bullish',3,soldiers,'三根阳线实体较强、收盘和低点依次抬高');
    record('three_black_crows','三只乌鸦','bearish',3,crows,'三根阴线实体较强、收盘和高点依次下降');
    record('bullish_engulfing','看涨吞没','bullish',2,down(b)&&up(c)&&c.open<=b.close&&c.close>=b.open&&bodyFraction(c)>=.5,'前阴后阳，后一根实体吞没前一根');
    record('bearish_engulfing','看跌吞没','bearish',2,up(b)&&down(c)&&c.open>=b.close&&c.close<=b.open&&bodyFraction(c)>=.5,'前阳后阴，后一根实体吞没前一根');
    if(n>=21){
      const prev=rows.slice(-21,-1),v20=prev.reduce((s,x)=>s+x.volume,0)/20;
      const low20=Math.min(...prev.map(x=>x.low));
      record('breakdown20_volume','20日低点放量破位','bearish',21,v20>0&&c.close<low20&&c.volume>=1.5*v20,
        '收盘跌破此前20日最低点，量至少为前20日均量1.5倍');
      record('heavy_distribution','放量长阴','bearish',21,v20>0&&c.close<=b.close*.97&&down(c)&&c.volume>=2*v20,
        '当日相对昨收跌幅至少3%，阴线且量至少为前20日均量2倍');
    }else{
      record('breakdown20_volume','20日低点放量破位','bearish',21,false,'至少需要21根完整日K');
      record('heavy_distribution','放量长阴','bearish',21,false,'至少需要21根完整日K');
    }
    return {usable:true,date:c.date,checks,positive:checks.filter(x=>x.side==='bullish'&&x.status==='matched'),
      risks:checks.filter(x=>x.side==='bearish'&&x.status==='matched')};
  }
  function render(result,meta={}){
    if(!result?.usable)return '<p>历史K线形态暂不可判断：'+esc(result?.reason||'缺少数据')+'。</p>';
    const group=(side,title)=>{
      const checks=result.checks.filter(x=>x.side===side),matched=checks.filter(x=>x.status==='matched');
      return '<section><h4>'+esc(title)+' · 命中'+matched.length+'项</h4><ul>'+checks.map(x=>{
        const state=x.status==='matched'?'命中':x.status==='insufficient_data'?'数据不足':'未命中';
        return '<li><b>'+esc(x.label)+'</b>：'+state+' · '+esc(x.detail)+'</li>';
      }).join('')+'</ul></section>';
    };
    const asOf=String(meta.asOf||'').slice(0,10),source=typeof meta.source==='string'?meta.source:'原有K线接口';
    return '<div data-v6-pattern-preview="historical"><p><b>历史日K形态预览（6项）</b> · 最新K线 '+esc(result.date)+
      ' · 接口截至 '+esc(asOf||'未标注')+' · 来源 '+esc(source)+'</p>'+group('bullish','看涨形态')+
      group('bearish','看跌风险形态')+'<small>仅历史形态研究，非实时盯盘、交易指令或胜率预测；完整战法、数据质量与回测请到研究工作台核验。风险命中不会被看涨项抵消。</small></div>';
  }
  return {evaluate,render};
});
