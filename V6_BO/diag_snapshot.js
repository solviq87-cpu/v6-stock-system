// -*- coding: utf-8 -*-
// 量化看盘·数据源 自检快照（只读聚合）
// 经 server.js 的 /api/diag 暴露，供本机 curl / 已登录设备查看退避与降级观测。
// 设计：纯函数、只读、任何一步失败都不崩，只把错误记进对应字段。
const fs = require('fs');
const path = require('path');

function buildSelfCheck(em) {
  const snap = { ok: true, at: Date.now(), ts: new Date().toISOString(), backoff: null, dayGuard: null, financial: null };
  try {
    snap.backoff = (em && typeof em.backoffStats === 'function') ? em.backoffStats() : null;
  } catch (e) { snap.backoff = { error: String((e && e.message) || e) }; }
  try {
    snap.dayGuard = (em && typeof em.dayGuardStats === 'function') ? em.dayGuardStats() : null;
  } catch (e) { snap.dayGuard = { error: String((e && e.message) || e) }; }
  // 财报季（只读 external_data.json；失败不崩）
  try {
    const f = path.join(__dirname, 'external_data.json');
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const fin = j && j.items && j.items.financials;
      snap.financial = { updated: j.time || null, season: (fin && fin.reportSeason) || null, total: (fin && fin.total) || null };
    }
  } catch (e) { snap.financial = { error: String((e && e.message) || e) }; }
  return snap;
}

module.exports = { buildSelfCheck };
