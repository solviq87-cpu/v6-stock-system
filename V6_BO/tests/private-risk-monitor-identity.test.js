'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRiskMonitor} = require('../scripts/private-risk-monitor');

test('legacy aggregate receipt uncertainty reaches the monitor without private identifiers', async () => {
  const monitor = createRiskMonitor({holdings:'/private/holdings.json', receipt:'/private/receipt.json', send:false}, {
    run: async () => ({status:'deduplicated-gateway-accepted', gatewayAccepted:false,
      legacyIdentityUnverified:true, privateEventId:'600001:cost-loss',
      counts:{positions:2, critical:1, warning:1, unknown:0}})
  });
  const result = await monitor.tick();
  assert.equal(result.legacyIdentityUnverified, true);
  assert.equal(result.gatewayAccepted, false);
  assert.equal(result.deliveredToDevice, false);
  assert.equal(result.canTrade, false);
  assert.doesNotMatch(JSON.stringify(result), /600001|cost-loss|holdings\.json|receipt\.json/);
});

test('only an explicit identity uncertainty boolean is propagated', async () => {
  for (const flag of [undefined, false, 'false']) {
    const monitor = createRiskMonitor({holdings:'/private/holdings.json', receipt:'/private/receipt.json', send:false}, {
      run: async () => ({status:'gateway-accepted', gatewayAccepted:true,
        legacyIdentityUnverified:flag, counts:{positions:1, critical:1, warning:0, unknown:0}})
    });
    const result = await monitor.tick();
    assert.equal(result.legacyIdentityUnverified, false);
    assert.equal(result.gatewayAccepted, true);
    assert.equal(result.deliveredToDevice, false);
  }
});
