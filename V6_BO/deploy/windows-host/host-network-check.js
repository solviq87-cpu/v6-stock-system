#!/usr/bin/env node
'use strict';

// Accept only the private HTTPS -> Windows loopback route used by this host.
// The report deliberately contains no Tailnet names, peers, IPs, or tokens.
function validateServe(config) {
  const result = code => ({ code, configurationVerified: code === 'private-serve-configured', phoneConnected: false, changed: false });
  if (!config || typeof config !== 'object' || Array.isArray(config)) return result('invalid-serve-status');
  const all = [config];
  let objects = 0;
  while (all.length) {
    const next = all.pop();
    if (++objects > 1000) return result('invalid-serve-status');
    for (const [key, value] of Object.entries(next)) {
      if (key === 'AllowFunnel' && value !== null) {
        if (typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(enabled => typeof enabled !== 'boolean')) return result('invalid-serve-status');
        if (Object.values(value).some(enabled => enabled === true)) return result('public-funnel-rejected');
      }
      if (key === 'Foreground' && value && Object.keys(value).length) return result('foreground-serve-rejected');
      if (value && typeof value === 'object') all.push(value);
    }
  }
  if (!config.TCP || !config.Web || !Object.keys(config.Web).length) return result('serve-not-configured');
  if (Object.entries(config.TCP).length !== 1 || config.TCP['443']?.HTTPS !== true || config.TCP['443']?.TCPForward) return result('non-https-route-rejected');
  const hosts = Object.entries(config.Web);
  if (hosts.length !== 1) return result('unexpected-serve-routes');
  for (const [host, entry] of hosts) {
    if (!/^[a-z0-9.-]+:443$/i.test(host) || !entry?.Handlers || Object.keys(entry.Handlers).length !== 1) return result('unexpected-serve-routes');
    const handler = entry.Handlers['/'];
    if (!handler || Object.keys(handler).length !== 1 || handler.Proxy !== 'http://127.0.0.1:8787') return result('non-loopback-proxy-rejected');
  }
  return result('private-serve-configured');
}

if (require.main === module) {
  let bytes = 0, input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= 65536) input += chunk; });
  process.stdin.on('end', () => {
    let report;
    try { report = validateServe(bytes <= 65536 ? JSON.parse(input.replace(/^\uFEFF/, '')) : null); }
    catch { report = validateServe(null); }
    console.log(JSON.stringify(report));
    process.exitCode = report.configurationVerified ? 0 : 1;
  });
}
module.exports = { validateServe };
