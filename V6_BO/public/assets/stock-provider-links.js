(function(root){
  'use strict';
  // External pages stay separate from cached candles: opening a page is not feed authentication.
  function links(code){
    if(typeof code!=='string'||!/^\d{6}$/.test(code))return [];
    const market=/^(60|68)/.test(code)?'sh':/^(00|30)/.test(code)?'sz':null;
    if(!market)return [];
    const symbol=market+code;
    return [
      {id:'eastmoney',name:'东方财富',url:'https://quote.eastmoney.com/'+symbol+'.html'},
      {id:'tonghuashun',name:'同花顺',url:'https://stockpage.10jqka.com.cn/'+code+'/'},
      {id:'sina',name:'新浪财经',url:'https://finance.sina.com.cn/realstock/company/'+symbol+'/5g.shtml'},
      {id:'xueqiu',name:'雪球',url:'https://xueqiu.com/S/'+symbol.toUpperCase()}
    ];
  }
  function render(code){
    const items=links(code);
    if(!items.length)return '<span class="muted">该市场暂无已核对的外部行情入口</span>';
    return '<nav aria-label="'+code+'外部行情" style="display:flex;gap:8px;flex-wrap:wrap">'+items.map(x=>
      '<a class="btn ghost" style="min-height:44px;display:inline-flex;align-items:center" href="'+x.url+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="在新窗口查看'+code+'的'+x.name+'行情">'+x.name+' ↗</a>').join('')+
      '</nav><small class="muted">外部行情网页 · 时间与延迟以来源页面为准；本程序未接入这些授权实时接口</small>';
  }
  const api=Object.freeze({links,render});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V6StockProviders=api;
})(typeof globalThis==='object'?globalThis:this);
