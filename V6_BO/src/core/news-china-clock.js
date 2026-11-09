'use strict';
// News digests run on China wall time even when the cloud worker uses UTC,
// Tokyo or another host timezone. This is ONLY a scheduler/calendar view;
// never use its clock as evidence of a market quote or a real delivery.
const OFFSET_MS = 8 * 60 * 60 * 1000;
function newsChinaClock(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0 || now > 8000000000000000 - OFFSET_MS)
    throw Error('新闻日程时钟无效');
  const d = new Date(now + OFFSET_MS);
  const isoDay = d.toISOString().slice(0, 10);
  const previousIsoDay = new Date(now + OFFSET_MS - 86400000).toISOString().slice(0, 10);
  // Match the small Date-getter interface used by the existing holiday gate.
  return Object.freeze({
    dayKey: isoDay.replace(/-/g, ''),
    isoDay, previousIsoDay,
    weekday: d.getUTCDay(),
    minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
    getDay: () => d.getUTCDay(),
    getHours: () => d.getUTCHours(),
    getMinutes: () => d.getUTCMinutes(),
    getFullYear: () => d.getUTCFullYear(),
    getMonth: () => d.getUTCMonth(),
    getDate: () => d.getUTCDate()
  });
}
module.exports = { newsChinaClock };
