const fs=require('fs');
const s=fs.readFileSync('server.js','utf8');
function fnBody(src,sig){const i=src.indexOf(sig);if(i<0)return '';const j=src.indexOf('{',i);if(j<0)return '';let depth=0;for(let k=j;k<src.length;k++){if(src[k]==='{')depth++;else if(src[k]==='}'){depth--;if(depth===0)return src.slice(j,k+1);}}return src.slice(j);}
const b=fnBody(s,'function isMainlineStock');
console.log('LEN',b.length);
console.log('HEAD',JSON.stringify(b.slice(0,60)));
console.log('TAIL',JSON.stringify(b.slice(-60)));
let d=0,min=99;for(const c of b){if(c==='{')d++;else if(c==='}'){d--;if(d<min)min=d;}}
console.log('finalDepth',d,'minDepth',min);
