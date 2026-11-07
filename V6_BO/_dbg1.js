const A=require('./analysis.js'),fs=require('fs'),path=require('path');
const rows=JSON.parse(fs.readFileSync(path.join('.kline_cache','002913.json'),'utf8')).rows;
for(const i of [30, 50, rows.length-1]){
  const sub=rows.slice(0,i+1);
  let t=null,err=null;
  try{ t=A.trendPoolCheck({rows:sub,fundDays:[{main:1e6},{main:1e6},{main:1e6}],price:sub[i].close,mainInflow:1e6,thsNetAmt:null,floatCap:60}); }
  catch(e){ err=e; }
  console.log(`--- i=${i} ${sub[i].date} 收${sub[i].close} ---`);
  if(err){ console.log('  ERR:', err.message); continue; }
  if(!t){ console.log('  null (rows<25?) len=', sub.length); continue; }
  console.log('  ok=',t.ok,'channel=',t.channel,'score=',t.trendScore,'hint=',t.trendScoreHint);
  console.log('  fundIn=',t.fundIn,'midOk=',t.midOk,'capOk=',t.capOk,'jumpy=',t.jumpy,'strongOk=',t.strongOk);
  console.log('  ma5up=',t.ma5up,'nearMa5=',t.nearMa5,'gentle=',t.gentle,'dev=',t.dev);
  console.log('  aboveMa20=',t.aboveMa20,'ma20up=',t.ma20up,'dd60=',t.dd60,'aboveMa10=',t.aboveMa10,'partBull=',t.partBull,'lb=',t.lb,'zt60=',t.zt60);
  console.log('  strongWhy=',t.strongWhy);
}
