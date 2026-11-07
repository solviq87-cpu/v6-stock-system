#!/usr/bin/env node
'use strict';
// Offline registry audit only. This does NOT contact providers or certify live data.
const fs = require('node:fs');
const path = require('node:path');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/data-source-catalog.json'), 'utf8'));
const expected = ['baostock','ashare','mootdx','efinance','cninfo','tencent','eastmoney','sina','ifind','choice','itick','joinquant','tushare','openbb'];
const ids = catalog.sources.map(s => s.id);
const errors = [];
if (catalog.scope !== 'private-research') errors.push('scope must remain private-research');
if (new Set(ids).size !== ids.length) errors.push('duplicate source ids');
for (const id of expected) if (!ids.includes(id)) errors.push('missing source: ' + id);
for (const id of ids) if (!expected.includes(id)) errors.push('unexpected source: ' + id);
for (const s of catalog.sources) {
  if (!s.adapter || !s.upstream || !s.access) errors.push('incomplete source metadata: ' + s.id);
}
const report = {
  ok: errors.length === 0,
  auditType: 'offline-registry-only',
  verifiedLiveFeeds: null,
  note: 'Registry presence is not provider connectivity, authorization, or realtime certification.',
  registered: ids.length,
  byAccess: catalog.sources.reduce((out,s) => {out[s.access]=(out[s.access]||0)+1;return out;}, {}),
  errors
};
console.log(JSON.stringify(report,null,2));
if (errors.length) process.exitCode=1;
