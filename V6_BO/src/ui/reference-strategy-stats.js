'use strict';

const DEFINITIONS = Object.freeze({
  rule14: ['十四条选股', '十四条', 'rule14', 'myrules'],
  bazi: ['八字口诀', '八字', 'bazi'],
  gpt: ['GPT五策略', 'GPT 五策略', 'GPT策略', 'gpt'],
  python: ['Python三轮筛选', 'Python三轮', 'python']
});

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function buildReferenceStrategyStats(rows, asOf = Date.now()) {
  const source = Array.isArray(rows) ? rows : [];
  const items = {};
  for (const [key, aliases] of Object.entries(DEFINITIONS)) {
    const accepted = new Set(aliases.map(normalize));
    const codes = new Set();
    let attributedRows = 0;
    for (const row of source) {
      if (!row || typeof row !== 'object') continue;
      const raw = row.strategy ?? row.strategyName ?? row.strategyKey ?? row.source;
      if (!accepted.has(normalize(raw))) continue;
      attributedRows++;
      const code = String(row.code ?? row.symbol ?? '').replace(/\D/g, '').slice(0, 6);
      if (/^\d{6}$/.test(code)) codes.add(code);
    }
    items[key] = {
      count: attributedRows ? codes.size : null,
      attributedRows,
      status: attributedRows ? 'attributed' : 'unavailable'
    };
  }
  return {
    ok: true,
    source: 'candidatePool-explicit-strategy-attribution',
    asOf: Number.isFinite(Number(asOf)) ? Number(asOf) : Date.now(),
    candidatePoolSize: source.length,
    items,
    note: '仅统计候选记录中明确标注的策略来源；未标注不推断归属。该数量不是策略绩效或收益统计。'
  };
}

module.exports = { buildReferenceStrategyStats, DEFINITIONS };
