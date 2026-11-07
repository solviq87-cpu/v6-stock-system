const fs=require('fs');
const s=fs.readFileSync('server.js','utf8');
function fnBody(src,sig){const i=src.indexOf(sig);if(i<0)return '';const j=src.indexOf('{',i);if(j<0)return '';let depth=0;for(let k=j;k<src.length;k++){if(src[k]==='{')depth++;else if(src[k]==='}'){depth--;if(depth===0)return src.slice(j,k+1);}}return src.slice(j);}
const bGate=fnBody(s,'function isMainlineStock');
const src='function isMainlineStock(z, secStrength)' + bGate + '\nreturn isMainlineStock;';
console.log('=== CONSTRUCTED ===');
console.log(src);
console.log('=== TRY ===');
try{ const fn=new Function('S',src); console.log('constructed OK'); const r=fn({mainline:{items:[{sector:'电池·储能',count:9,maxLb:4}]}})({sector:'电池·储能'},{theme:'电池·储能',score:50}); console.log('RESULT',JSON.stringify(r)); }
catch(e){ console.log('ERR',e.message); }
