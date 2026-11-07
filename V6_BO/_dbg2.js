const A=require('./analysis.js'),fs=require('fs'),path=require('path');
const SRC=fs.readFileSync('server.js','utf8');
// 从 server.js 源码里原样抠出新增的那几行，用真实的 t 跑一遍（不是我另写一份）
function grab(startMark, endMark){
  const i=SRC.indexOf(startMark); if(i<0) return '';
  const j=SRC.indexOf(endMark, i); return j<0? '' : SRC.slice(i, j);
}
const techSrc = grab('const techBits = [];', 'const why = `${shape}，叠加${fundTxt}${techTxt}`;');
const flagsSrc = grab("t.channel ? `通道·${t.channel}` : null,", "t.fenxing && t.fenxing.last ? `缠论${t.fenxing.last}` : null,");
if(!techSrc || !flagsSrc){ console.log('抠源码失败', !!techSrc, !!flagsSrc); process.exit(1); }

for(const [code,name] of [['002913','奥士康'],['000011','深物业A'],['000678','襄阳轴承']]){
  const rows=JSON.parse(fs.readFileSync(path.join('.kline_cache',code+'.json'),'utf8')).rows;
  const t=A.trendPoolCheck({rows,fundDays:[{main:1e6},{main:1e6},{main:1e6}],price:rows[rows.length-1].close,mainInflow:1e6,thsNetAmt:null,floatCap:60e8});
  if(!t){ console.log(name,'null'); continue; }
  const fundTxt='近3日主力净流入100万';
  const shape='多头排列主升';
  const fn=new Function('t','fundTxt','shape', techSrc + '\n' + 'return {techTxt, why: `${shape}，叠加${fundTxt}${techTxt}`};');
  const r=fn(t,fundTxt,shape);
  const fl=new Function('t', 'return [' + flagsSrc + '];');
  console.log(`\n【${name}】ok=${t.ok} 通道=${t.channel} 分=${t.trendScore}`);
  console.log('  why:', r.why);
  console.log('  flags新增:', JSON.stringify(fl(t)));
}
