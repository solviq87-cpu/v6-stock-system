'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildIntelligenceResearch} = require('../src/core/intelligence-research');
const {buildGovernance} = require('../src/core/fayo-research-governance');
const {createResearchGovernanceCache, strategyDecayFromProjection, MAX_AGE_MS} = require('../src/core/research-governance-cache');
const {readResearchRiskCenter} = require('../src/core/research-risk-center');
const now = Date.parse('2026-11-25T16:00:00+08:00');
const report = () => buildIntelligenceResearch({day:'2026-11-25', now, archive:null});

test('真实研究投影进入原风险中心，保留时间与未知状态且不泄漏私有资料', () => {
  const cache = createResearchGovernanceCache(), original = report();
  original.privatePath = '/private/account';
  original.notes = [{text:'PRIVATE_NOTE_NOT_FOR_RISK'}];
  const before = JSON.stringify(original);
  assert.equal(cache.remember(original, {now}), true);
  const projection = cache.read({now});
  const risk = readResearchRiskCenter({now, governance:projection});
  assert.equal(risk.strategyDecay.status, 'unknown');
  assert.equal(risk.strategyDecay.sourceFingerprint, original.fingerprint);
  assert.equal(risk.strategyDecay.evidenceAsOf, now);
  assert.equal(risk.strategyDecay.verifiedDecay, false);
  assert.equal(risk.strategyDecay.estimate, null);
  assert.ok(risk.strategyDecay.observations.some(r => r.code === 'INSUFFICIENT_MATCHED_SAMPLES'));
  assert.doesNotMatch(JSON.stringify(projection), /PRIVATE_NOTE|private\/account/);
  assert.equal(JSON.stringify(original), before);
});

test('原治理原因码完整投影，成本压力不冒充真实成本上涨或衰减认证', () => {
  const cache = createResearchGovernanceCache(), original = report();
  original.governance = buildGovernance({now, quality:{components:[{key:'coverage', value:.5}]},
    execution:{overall:{costStressPassed:false}}});
  assert.equal(cache.remember(original, {now}), true);
  const value = cache.read({now}), risk = readResearchRiskCenter({now, governance:value});
  assert.ok(value.reasons.some(r => r.code === 'DATA_QUALITY_GAP'));
  assert.ok(value.reasons.some(r => r.code === 'COST_PRESSURE'));
  assert.equal(risk.strategyDecay.status, 'review-observed-unverified');
  assert.equal(risk.strategyDecay.verifiedDecay, false);
  assert.ok(risk.supports.some(r => r.code === 'RESEARCH_REVIEW_OBSERVED'));
  assert.ok(risk.missing.some(r => r.code === 'DECAY_NOT_ESTABLISHED'));
});

test('过期、未来、乱序与修改返回对象不能刷新或篡改原证据', () => {
  const cache = createResearchGovernanceCache();
  assert.equal(cache.remember(report(), {now}), true);
  const exposed = cache.read({now});
  exposed.asOf = now + 5000; exposed.reasons.length = 0;
  assert.equal(cache.read({now}).asOf, now);
  assert.ok(cache.read({now}).reasons.length > 0);
  assert.equal(cache.read({now:now - 1}).status, 'future-research');
  assert.equal(cache.read({now:now + MAX_AGE_MS + 1}).status, 'stale-research');
  const late = cache.read({now:now + MAX_AGE_MS + 1});
  assert.equal(strategyDecayFromProjection(late, {now:now + MAX_AGE_MS + 1}).status, 'stale-research');
  assert.equal(late.asOf, now);
  const old = buildIntelligenceResearch({day:'2026-11-24', now:now - 86400000});
  cache.remember(old, {now});
  assert.equal(cache.read({now}).asOf, now);
  const malformed = report(); malformed.governance.canTrade = true;
  assert.equal(cache.remember(malformed, {now}), false);
  assert.equal(cache.read({now}).status, 'missing-research');
});

test('原生徽章按原字段区分规则分、历史频率、估计和未分类研究值', async () => {
  const {observedBadge} = await import('../public/nova/stock-roles.js');
  assert.deepEqual(observedBadge({score:0,prob:90,probKind:'model-estimate'}), {value:'0',caption:'评分'});
  assert.equal(observedBadge({prob:0,probKind:'score'}).caption, '规则评分');
  assert.equal(observedBadge({prob:60,probKind:'historical-event-frequency'}).caption, '历史事件频率');
  assert.equal(observedBadge({prob:60,probKind:'model-estimate',calibrationCertified:true}).caption, '模型估计（未校准）');
  assert.equal(observedBadge({prob:60}).caption, '研究值（类型待核验）');
});
