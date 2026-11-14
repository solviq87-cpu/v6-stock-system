#!/usr/bin/env node
'use strict';
// No network, brokerage, persisted account mutation or automatic authorization.
const {validateRegistry,sourceSummary}=require('../src/core/data-source-lineage');
const status=validateRegistry();
console.log(JSON.stringify({ok:true,scope:'source-discovery-not-live-entitlement',
 legacyCatalogProtected:true,...status,warning:'89 registered routes are NOT 89 online/independent/licensed live feeds. Zero newly authorized provider credentials.'},null,2));
