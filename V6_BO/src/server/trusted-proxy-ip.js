'use strict';
/**
 * Resolve the address used by authentication throttles and device audit.
 * Forwarding headers are user-controlled unless the direct TCP peer is
 * explicitly trusted by QD_TRUSTED_PROXY_IPS (comma-separated IP literals).
 * The proxy must append/overwrite X-Forwarded-For, never simply pass a
 * client-supplied header through without adding the actual remote address.
 */
const net = require('node:net');
function normalizeIp(raw) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || value.length > 64) return '';
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;
  return net.isIP(mapped) ? mapped.toLowerCase() : '';
}
function clientIp(req, trustedProxies = process.env.QD_TRUSTED_PROXY_IPS || '') {
  const peer = normalizeIp(req && req.socket && req.socket.remoteAddress);
  if (!peer) return '';
  const trusted = new Set(String(trustedProxies).split(',').map(normalizeIp).filter(Boolean));
  if (!trusted.has(peer)) return peer;
  const raw = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return peer;
  const hops = raw.split(',');
  if (!hops.length || hops.length > 16) return peer;
  const chain = hops.map(normalizeIp);
  // Malformed or ambiguous forwarding chains are not reliable IP evidence.
  if (chain.some(ip => !ip)) return peer;
  // Rightmost untrusted hop is the actual external client; preceding entries
  // can be spoofed by that client and must never determine a throttle key.
  for (let i = chain.length - 1; i >= 0; --i) {
    if (!trusted.has(chain[i])) return chain[i];
  }
  return chain[0];
}
module.exports = { clientIp, normalizeIp };
