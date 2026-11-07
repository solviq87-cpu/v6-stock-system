'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPaperOrderStore } = require('../src/core/paper-order-store');
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-order-store-')); return { root, store: createPaperOrderStore(root), order: { orderId: 'ord_001', symbol: '600000', side: 'buy', quantity: 200 } }; }
test('creates an order durably and restores pending state', () => { const x=fixture(); const s=x.store.create(x.order); assert.equal(s.status,'pending'); assert.equal(x.store.get('ord_001').state.remainingQuantity,200); });
test('appends events and rebuilds partial/final fill after restart', () => { const x=fixture(); x.store.create(x.order); x.store.append('ord_001',{eventId:'e1',sequence:1,type:'fill',quantity:100,price:10}); const reopened=createPaperOrderStore(x.root); assert.equal(reopened.get('ord_001').state.status,'partial'); reopened.append('ord_001',{eventId:'e2',sequence:2,type:'fill',quantity:100,price:11}); assert.equal(reopened.get('ord_001').state.averageFillPrice,10.5); });
test('same event id and same payload is idempotent', () => { const x=fixture(); x.store.create(x.order); const e={eventId:'e1',sequence:1,type:'fill',quantity:100,price:10}; x.store.append('ord_001',e); x.store.append('ord_001',e); assert.equal(x.store.get('ord_001').events.length,1); });
test('same event id with different payload is rejected', () => { const x=fixture(); x.store.create(x.order); x.store.append('ord_001',{eventId:'e1',sequence:1,type:'fill',quantity:100,price:10}); assert.throws(()=>x.store.append('ord_001',{eventId:'e1',sequence:1,type:'fill',quantity:100,price:11}),/不同事件内容/); });
test('concurrent writer lock rejects a second process and keeps state intact', () => { const x=fixture(); x.store.create(x.order); const lock=path.join(x.root,'ord_001.order.json.lock'); fs.writeFileSync(lock,'other'); assert.throws(()=>x.store.append('ord_001',{eventId:'e1',sequence:1,type:'fill',quantity:100,price:10}),/并发写入/); fs.unlinkSync(lock); assert.equal(x.store.get('ord_001').state.status,'pending'); });
test('journal tampering is detected', () => { const x=fixture(); x.store.create(x.order); const f=path.join(x.root,'ord_001.order.json'); const v=JSON.parse(fs.readFileSync(f)); v.events.push({eventId:'evil'}); fs.writeFileSync(f,JSON.stringify(v)); assert.throws(()=>x.store.get('ord_001'),/指纹校验失败/); });
test('rejects unsafe order ids', () => { const x=fixture(); assert.throws(()=>x.store.create({...x.order,orderId:'../evil'}),/安全文件名/); });
