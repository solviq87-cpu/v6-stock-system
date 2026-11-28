'use strict';
// Two frozen documents for the S14 acceptance replay. Not a general NBS parser.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const sources = [
  {vintage:'初步核算',title:'2024年四季度和全年国内生产总值初步核算结果',path:'202501/t20250118_1958363.html',
    sha256:'278383cce68511b7668d5ec7bd35fe7403ab9741636dbbf2585ca78689a0d716',pubDate:'2025/01/18 09:30',
    headings:[['','绝对额（亿元）','比上年同期增长（%）'],['四季度','全年','四季度','全年']],amountColumn:2,growthColumn:4},
  {vintage:'最终核实',title:'国家统计局关于2024年国内生产总值最终核实的公告',path:'202512/t20251226_1962144.html',
    sha256:'c1970caa2e8d276c2fff7c462641abdddf59d828d9ee3fc3139a754595b25188',pubDate:'2025/12/26 09:30',
    headings:[['行业','现价总量（亿元）','不变价增速（％）','产业结构（％）']],amountColumn:1,growthColumn:2}
];

function readPublication(file, spec) {
  assert.ok(fs.statSync(file).size <= 2*1024*1024,'文件超过验收预算');
  const raw = fs.readFileSync(file), html = new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const rawHash = crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(rawHash,spec.sha256,'原文版本变化，需要核对新的快照');
  assert.equal(html.match(/<meta name="PubDate" content="([^"]+)"/)?.[1],spec.pubDate);
  assert.ok(html.includes(spec.title));
  const firstTable = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  assert.ok(firstTable,'缺少原文数据表');
  const rows = Array.from(firstTable[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),r=>
    Array.from(r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),c=>
      c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;|\s+/g,'').trim()));
  assert.deepEqual(rows.slice(0,spec.headings.length),spec.headings);
  const gdp=rows.filter(r=>r[0]==='GDP');assert.equal(gdp.length,1);
  const amount=gdp[0][spec.amountColumn],growth=gdp[0][spec.growthColumn];
  assert.match(amount,/^\d+$/);assert.match(growth,/^\d+\.\d+$/);
  const publishedAt=Date.parse(spec.pubDate.replaceAll('/','-').replace(' ','T')+':00+08:00');
  return {source:'nbs-cn',eventId:'nbs:gdp:annual:2024',sourceRevisionId:spec.path.split('/')[1].split('.')[0],schemaVersion:1,
    url:'https://www.stats.gov.cn/sj/zxfb/'+spec.path,title:spec.title,securities:[],kind:'original',supersedes:null,
    bodyScope:'provider-summary',body:'国家统计局。2024年全国GDP（'+spec.vintage+'）。现价总量 '+amount+' 亿元，不变价同比增速 '+growth+'%。',
    publishedAt,revisedAt:null,receivedAt:Date.now()};
}

async function replay({initialFile,finalFile,endpoint,cli,request,p,token}) {
  const endpointAt = async time=>{
    const response=await request(p,endpoint+'?limit=200&asOf='+time,'GET',null,token);
    assert.equal(response.status,200);
    return response.body.result.rows.filter(r=>r.evidence.source==='nbs-cn'&&r.evidence.eventId==='nbs:gdp:annual:2024');
  };
  const initial=readPublication(initialFile,sources[0]),first=cli(initial);
  const currentBefore=await endpointAt(Date.now()),cutoff=currentBefore[0].recordedAt;
  assert.equal(currentBefore.length,1);assert.match(currentBefore[0].evidence.body,/1349084 亿元/);
  const final=readPublication(finalFile,sources[1]);
  const revised={...final,kind:'revised',supersedes:first.eventHash,publishedAt:initial.publishedAt,revisedAt:final.publishedAt};
  const second=cli(revised);
  assert.equal(cli(revised).eventHash,second.eventHash);
  const beforeIngestion=await endpointAt(initial.publishedAt+1);
  const frozen=await endpointAt(cutoff),latest=await endpointAt(Date.now());
  assert.equal(beforeIngestion.length,0);assert.equal(frozen.length,1);assert.equal(frozen[0].eventHash,first.eventHash);
  assert.match(frozen[0].evidence.body,/1349084 亿元/);assert.ok(frozen[0].current);
  assert.equal(latest.length,2);assert.equal(latest[0].evidence.supersedes,first.eventHash);
  assert.equal(latest[0].eventHash,second.eventHash);assert.equal(latest[1].current,false);
  assert.equal(latest[0].current,true);assert.match(latest[0].evidence.body,/1348066 亿元/);
  assert.ok(latest.every(r=>r.evidence.body.includes('5.0%')&&r.eligibleForResearchSupport===false));
  const fields=r=>({eventHash:r.eventHash,supersedes:r.evidence.supersedes,current:r.current,recordedAt:r.recordedAt,
    locallyReadAt:r.evidence.receivedAt,publishedAt:r.evidence.publishedAt,revisedAt:r.evidence.revisedAt,
    url:r.evidence.url,title:r.evidence.title,summary:r.evidence.body,bodyScope:r.evidence.bodyScope});
  return {mode:'isolated-real-http-with-official-historical-documents',route:endpoint,
    rawHashes:sources.map(({sha256,path})=>({sha256,path})),cutoff,beforeLocalImport:beforeIngestion.length,
    frozen:frozen.map(fields),latest:latest.map(fields),duplicateRevisionCount:latest.length,canTrade:false,productionDeployed:false};
}
module.exports={replay};
