'use strict';

// Price equality identifies a candidate only. An undated intraday snapshot is
// not evidence that the stock remained sealed at the requested session's close.
function eligibleSupplementRows(rows, requestedDay, now = Date.now()) {
  const day = String(requestedDay || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(day) || !Number.isSafeInteger(now) || now <= 0) return [];
  const start = Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00+08:00`);
  if (!Number.isFinite(start) || start > now ||
      new Date(start + 8 * 3600000).toISOString().slice(0,10).replace(/-/g,'') !== day) return [];
  const close = start + 15 * 3600000;
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const at = row?.quoteAt, received = row?.receivedAt;
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(received) || at <= 0 ||
        at > received || received > now || at < start || at >= start + 86400000 ||
        typeof row.quoteSource !== 'string' || !row.quoteSource.trim()) return false;
    // After close, only a same-session closing observation can supplement it.
    // During the session, the existing 15-second original-time boundary applies.
    return now >= close ? at >= close : now - at <= 15000;
  });
}

module.exports = {eligibleSupplementRows};
