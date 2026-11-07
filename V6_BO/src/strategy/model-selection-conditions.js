'use strict';

const keys = ['minAverageTurnover20', 'maxVolatility20', 'minVolumeRatio20', 'maxVolumeRatio20'];

function validateModelFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) ||
      Object.keys(filters).some(key => !keys.includes(key))) throw Error('模型筛选条件无效或含未知字段');
  for (const key of Object.keys(filters)) {
    if (!Number.isFinite(filters[key]) || filters[key] < 0) throw Error('模型筛选阈值必须为非负有限数值');
  }
  if (filters.minVolumeRatio20 !== undefined && filters.maxVolumeRatio20 !== undefined &&
      filters.minVolumeRatio20 > filters.maxVolumeRatio20) throw Error('量比下限不能高于上限');
}

// All observations end at the signal close. Amount is supplied in yuan; volume
// is never converted to money because its unit differs between data providers.
function evaluateModelFilters(bars, day, features, filters = {}) {
  const reasons = [];
  if (filters.minAverageTurnover20 !== undefined) {
    const window = bars.slice(day - 19, day + 1);
    if (window.length !== 20 || window.some(bar => !Number.isFinite(bar.amount) || bar.amount < 0)) {
      reasons.push('TURNOVER20_UNKNOWN');
    } else if (window.reduce((sum, bar) => sum + bar.amount / 20, 0) < filters.minAverageTurnover20) {
      reasons.push('TURNOVER20_TOO_LOW');
    }
  }
  for (const [key, feature, reject, reason] of [
    ['maxVolatility20', 'volatility20', (value, threshold) => value > threshold, 'VOLATILITY20_TOO_HIGH'],
    ['minVolumeRatio20', 'volumeRatio20', (value, threshold) => value < threshold, 'VOLUME_RATIO20_TOO_LOW'],
    ['maxVolumeRatio20', 'volumeRatio20', (value, threshold) => value > threshold, 'VOLUME_RATIO20_TOO_HIGH'],
  ]) {
    if (filters[key] === undefined) continue;
    if (!Number.isFinite(features?.[feature])) reasons.push(feature.toUpperCase() + '_UNKNOWN');
    else if (reject(features[feature], filters[key])) reasons.push(reason);
  }
  return {pass: reasons.length === 0, reasons};
}

module.exports = {validateModelFilters, evaluateModelFilters};
