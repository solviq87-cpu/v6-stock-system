'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {request}=require('./helpers/v6-studio-fixture');
test('native HTTP fixture preserves Chinese JSON when every UTF8 character crosses response chunks',async t=>{
 const expected={ok:true,reason:'没有同日因子快照；真实来源、未成交及未知均保留。',symbol:'600000'},raw=Buffer.from(JSON.stringify(expected));
 const server=http.createServer(async(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});for(const byte of raw){res.write(Buffer.from([byte]));await new Promise(resolve=>setImmediate(resolve));}res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await request(server.address().port,'/');assert.equal(response.status,200);assert.deepEqual(response.body,expected);assert.equal(response.raw,raw.toString('utf8'));assert.equal(response.raw.includes('\uFFFD'),false);
});
