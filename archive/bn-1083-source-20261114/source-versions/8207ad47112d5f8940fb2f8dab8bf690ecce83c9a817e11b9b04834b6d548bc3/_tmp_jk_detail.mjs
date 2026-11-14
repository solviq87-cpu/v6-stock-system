import { fetchAllStocks } from './em.js';
const all = await fetchAllStocks();
const s = all.find(x=>x.code==='603337');
console.log('杰克科技 新浪快照:', JSON.stringify(s, null, 1));
