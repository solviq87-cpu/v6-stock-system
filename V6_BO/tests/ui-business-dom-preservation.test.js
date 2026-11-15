'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('./fixtures/ui-business-dom-baseline-20261115.json');
const root = path.resolve(__dirname, '../public');

// The owner explicitly authorized replacing the November 9 visual freeze on
// November 15. Preserve the business contract independently of visual hashes:
// moving controls must not remove their identities, handlers or runtime code.
for (const [page, contract] of Object.entries(baseline.pages)) {
  test(page + ' retains every pre-redesign business DOM identity and action', () => {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
    const handlers = new Set([...source.matchAll(/\bon(?:click|input|change|submit|keydown)=(["'])(.*?)\1/g)].map(m => m[2]));
    const scripts = new Set([...source.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(m => m[1].split('?')[0]));
    assert.deepEqual(contract.ids.filter(id => !ids.has(id)), [], 'Removed business DOM IDs; provide a reviewed migration instead');
    assert.deepEqual(contract.eventHandlers.filter(action => !handlers.has(action)), [], 'Removed business event actions');
    assert.deepEqual(contract.scripts.map(s => s.split('?')[0]).filter(s => !scripts.has(s)), [], 'Removed original runtime scripts');
    for (const [id, role] of Object.entries(contract.restrictedRoles || {})) {
      const tag = [...source.matchAll(/<[^>]+>/g)].map(m=>m[0]).find(tag=>tag.includes('id="'+id+'"') || tag.includes("id='"+id+"'"));
      assert.equal(tag?.match(/\bdata-eo=(["'])(.*?)\1/)?.[2], role, id+' role-restricted presentation changed');
    }
  });
}
