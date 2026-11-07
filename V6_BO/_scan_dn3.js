const fs=require('fs');const SV=fs.readFileSync('server.js','utf8');
function blockFrom(src,start){let i=src.indexOf('(',start);if(i<0)return '';let d=0;const s=i;
 for(;i<src.length&&i<s+600;i++){const c=src[i];if(c==='(')d++;else if(c===')'){d--;if(d===0)return src.slice(s+1,i);}}return '';}
function fieldVal(block,key){const i=block.indexOf(key+':');if(i<0)return null;let j=i+key.length+1,d=0;
 for(;j<block.length;j++){const c=block[j];if(c==='('||c==='{'||c==='[')d++;else if(c===')'||c==='}'||c===']')d--;
 else if((c===','||c==='\n')&&d===0)break;}return block.slice(i+key.length+1,j).trim();}
const re=/taskSet\(\s*'([A-Za-z]+)'\s*,/g;let m;const rows=[];
while((m=re.exec(SV))){const b=blockFrom(SV,m.index);const n=fieldVal(b,'n');rows.push([m[1],n]);}
const cnt={};for(const[r,n]of rows){if(n==null)continue;const k=n.replace(/'[^']*'/g,"'X'");cnt[k]=(cnt[k]||0)+1;}
console.log('taskSet 调用数:',rows.length);
for(const r of rows) console.log('  ',r[0],'=>',JSON.stringify(r[1]));
console.log('--- n: 表达式归类');for(const k of Object.keys(cnt))console.log('  ',cnt[k],k);
