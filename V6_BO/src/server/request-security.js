'use strict';
const crypto = require('node:crypto');

function httpOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\x00-\x20\x7f\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : '';
  } catch { return ''; }
}

// Forwarding headers are supplied by clients unless a proxy is independently
// trusted. Use an operator-configured public URL for TLS termination instead.
function sameOriginOk(req, env = process.env) {
  const headers = req.headers || {};
  // Browsers may omit both Origin and Referer on an image/navigation request.
  // Fetch Metadata is browser-controlled and still identifies those requests.
  if (headers['sec-fetch-site'] !== undefined &&
      !['same-origin', 'none'].includes(headers['sec-fetch-site'])) return false;
  // Origin is a serialized origin, not a general URL. Do not let URL
  // normalization erase conflicting or malformed header characters.
  if (headers.origin !== undefined && (typeof headers.origin !== 'string' ||
      !/^https?:\/\/[^/\s,\\@?#]+$/i.test(headers.origin))) return false;
  const sources = [headers.origin, headers.referer].filter(value => value !== undefined);
  if (!sources.length) return true;
  const allowed = new Set();
  if (typeof headers.host === 'string' && !/[\s,\\\/@?#]/.test(headers.host)) {
    const direct = httpOrigin((req.socket?.encrypted ? 'https://' : 'http://') + headers.host);
    if (direct) allowed.add(direct);
  }
  for (const value of [env.QD_PUBLIC_URL, env.RENDER_EXTERNAL_URL]) {
    const origin = value && httpOrigin(value);
    if (origin) allowed.add(origin);
  }
  return sources.every(value => typeof value === 'string' && allowed.has(httpOrigin(value)));
}

// Existing local Windows onboarding is retained. Public Render onboarding is
// closed until the operator provides a private, one-time bootstrap capability.
function initialSetupAuthorized(req, body, env = process.env) {
  if (env.RENDER !== 'true' && env.QD_REQUIRE_SETUP_TOKEN !== '1') return true;
  const expected = env.QD_SETUP_TOKEN;
  const header = req.headers?.['x-v6-setup-token'], bodyToken = body?.setupToken;
  if (header !== undefined && bodyToken !== undefined && header !== bodyToken) return false;
  const supplied = header !== undefined ? header : bodyToken;
  if (typeof expected !== 'string' || !/^[A-Za-z0-9._~-]{32,256}$/.test(expected) ||
      typeof supplied !== 'string' || !/^[A-Za-z0-9._~-]{32,256}$/.test(supplied) || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

module.exports = { sameOriginOk, initialSetupAuthorized };
