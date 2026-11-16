'use strict';

// Error reports can contain legacy query credentials or a failed fetch's
// Authorization header. Keep locations and error text, never those credentials.
function diagnosticUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.username = ''; u.password = ''; u.search = ''; u.hash = '';
    return u.href;
  } catch { return ''; }
}

function diagnosticText(value, limit) {
  return String(value || '').slice(0, limit * 4)
    .replace(/https?:\/\/[^\s<>"'`\\]+/gi, value => diagnosticUrl(value) || '[URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|device[_-]?token|reset[_-]?token|token|authorization|sharecode|password|passwd|pwd|secret|api[_-]?key|machine[_-]?key|密码|口令|密钥|秘钥)(?:["']?)\s*[:=：]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi,
      '$1[REDACTED]')
    .slice(0, limit);
}

function sanitizeClientError(input) {
  const b = input && typeof input === 'object' ? input : {};
  return {
    msg: diagnosticText(b.msg, 500), stack: diagnosticText(b.stack, 4000),
    where: diagnosticText(b.where, 60), ua: diagnosticText(b.ua, 300),
    url: diagnosticUrl(b.url).slice(0, 500)
  };
}

module.exports = { diagnosticUrl, diagnosticText, sanitizeClientError };
