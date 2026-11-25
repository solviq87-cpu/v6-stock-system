// The same pure implementation is used by the browser research view and the
// CommonJS report worker, including on Node versions before require(ESM).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'FayoNumericFactorsV1', {value: api});
})(globalThis, function () {
  'use strict';
  const PANEL = 'fayo-rule-observations-v1', SEMANTICS = 'condition-match-percent-v1';
  const MODEL = 'fayo-numeric-orthogonal-v1', finite = Number.isFinite;
  const realEvidence = row => row && typeof row === 'object' &&
    !['test','demo','synthetic'].includes(row.sampleSet) && !['test','demo','synthetic'].includes(row.sampleScope) &&
    !['test','demo','synthetic'].includes(row.scope) && ![true,1,'true','1','是'].includes(row.testSample) &&
    ![true,1,'true','1','是'].includes(row.isTest) && row.synthetic !== true && row.mock !== true &&
    row.quality !== '教学样本' && !/^合成教学样本/.test(row.name || '') &&
    !/(?:^|[-_: /])(fixture|simulated|synthetic|mock|demo)(?:$|[-_: /])/i.test(String(row.source || ''));
  const clone = value => JSON.parse(JSON.stringify(value));
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const stable = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
  // SHA-256 is synchronous because the existing research reducer is synchronous.
  // This identifies frozen definitions/models; it is not an authentication key.
  function fingerprint(value) {
    const bytes = new TextEncoder().encode(stable(value)), size = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
    const view = new DataView(data.buffer), bitLength = bytes.length * 8;
    view.setUint32(size - 8, Math.floor(bitLength / 4294967296)); view.setUint32(size - 4, bitLength >>> 0);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotr = (x,n) => x >>> n | x << 32 - n, w = new Int32Array(64);
    for (let offset = 0; offset < size; offset += 64) {
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = view.getInt32(offset + i * 4);
        else { const x = w[i-15], y = w[i-2]; w[i] = (w[i-16] + (rotr(x,7)^rotr(x,18)^x>>>3) + w[i-7] + (rotr(y,17)^rotr(y,19)^y>>>10)) | 0; }
      }
      let [a,b,c,d,e,f,g,q] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (q + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + (e&f ^ ~e&g) + k[i] + w[i]) | 0;
        const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + (a&b ^ a&c ^ b&c)) | 0;
        q=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      [a,b,c,d,e,f,g,q].forEach((v,i) => { h[i]=(h[i]+v)|0; });
    }
    return h.map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
  }
  function instant(value) {
    if (Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value !== 'string' || !/[T ]\d\d:\d\d/.test(value)) return null;
    const input = value.replace(' ','T'), t = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(input) ? input : input + '+08:00');
    return Number.isSafeInteger(t) && t > 0 ? t : null;
  }
  const codeOf = rule => 'YZ-' + String(rule.id).padStart(2,'0');
  const ruleDefinition = rule => ({factorCode: codeOf(rule), semanticVersion: SEMANTICS, unit: 'condition-match-percent',
    ruleId: rule.id, kind: rule.kind, name: rule.name, conditions: [...rule.factors]});
  const definitions = catalog => catalog.filter(rule => Number.isSafeInteger(rule.id) && rule.id > 0 && rule.id <= 95)
    .map(ruleDefinition).sort((a,b) => a.ruleId-b.ruleId);
  const dayOk = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    finite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
  function inputDay(value) {
    if (typeof value !== 'string' || !dayOk(value.slice(0,10)) || value.length > 10 && instant(value) === null) return null;
    return value.slice(0,10);
  }
  function sourceScope(row, code, day) {
    if (!row || !dayOk(day) || !dayOk(row.day) || !dayOk(row.endDay) || row.day > row.endDay || row.endDay > day ||
        row.sourceDatesValid !== true) return false;
    if (['stock','trusted-close-snapshot'].includes(row.role)) return /^\d{6}$/.test(code) && row.code === code;
    if (row.role === 'sector-peer') return typeof row.code === 'string' && /^\d{6}$/.test(row.code) &&
      row.subjectCode === code && typeof row.sector === 'string' && row.sector.trim().length > 0;
    if (row.role === 'market') return row.code === null || typeof row.code === 'string' && row.code.length > 0;
    return ['index','sector'].includes(row.role) && typeof row.code === 'string' && row.code.length > 0;
  }
  function buildRulePanel({catalog, facts, code, day, cutoff, dictionaryVersion, inputs = [], settingsVersion = null, settings = {}}) {
    const defs = definitions(catalog), point = instant(cutoff);
    const rawSources = inputs.map(row => ({role: row.role || 'stock', code: row.code || null, day: inputDay(row.date || row.day),real:realEvidence(row),
      subjectCode: row.subjectCode || null, sector: row.sector || null,
      source: typeof row.source === 'string' && row.source.trim() ? row.source : null,
      knownAt: instant(row.knownAt ?? row.recordedAt), sourceAt: instant(row.sourceTimestamp ?? row.quoteAt),
      reference: row.evidenceId || row.sourceFingerprint || row.rawHash || null, inputFingerprint: fingerprint(row)}));
    const groups = new Map();
    for (const row of rawSources) {
      const key = stable([row.role,row.code,row.source,row.subjectCode,row.sector]);
      if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(row);
    }
    // Store source ranges and hashes, not thousands of duplicate minute/daily
    // rows. The original source rows remain in the original research archive.
    const sources = [...groups.values()].map(rows => {
      const days = rows.map(row => row.day).filter(Boolean).sort(), clocks = rows.map(row => row.sourceAt).filter(finite);
      return {role:rows[0].role,code:rows[0].code,source:rows[0].source,day:days[0]||null,endDay:days.at(-1)||null,records:rows.length,
        subjectCode:rows[0].subjectCode,sector:rows[0].sector,sourceDatesValid:rows.every(row=>dayOk(row.day)),sourceRecordsReal:rows.every(row=>row.real),
        knownAt:rows.every(row=>row.knownAt!==null)?Math.max(...rows.map(row=>row.knownAt)):null,
        sourceAt:clocks.length?Math.max(...clocks):null,
        sourceTimesValid:rows.every(row=>row.sourceAt===null||row.knownAt!==null&&row.sourceAt<=row.knownAt),
        evidenceFingerprint:fingerprint(rows)};
    });
    const provenance = sources.length > 0 && point !== null && sources.every(row => sourceScope(row,code,day) &&
      row.source && row.knownAt !== null && row.knownAt <= point && row.sourceTimesValid && row.sourceRecordsReal);
    const rules = defs.map(definition => {
      const sources = {}, states = definition.conditions.map((name,i) => {
        const fact = facts.get(definition.ruleId + ':' + i), known = typeof fact?.pass === 'boolean' && typeof fact.source === 'string' && fact.source.trim();
        if (known) sources[i+1] = fact.source;
        return known ? fact.pass ? 'p' : 'f' : '?';
      }).join('');
      const matched = [...states].filter(value => value === 'p').length, complete = states.length > 0 && !states.includes('?');
      return {factorCode: definition.factorCode, states, sources, value: complete && provenance ? matched / states.length * 100 : null};
    });
    return {schema: PANEL, semanticVersion: SEMANTICS, dictionaryVersion, code, day, cutoff: point,
      source: 'shortline-condition-evaluator', settingsVersion, settings: clone(settings), settingsFingerprint: fingerprint(settings),
      encoding: 'ordinal-passed-failed-unknown-v1', catalogFingerprint: fingerprint(defs), inputs: sources, rules,
      note: '完整条件满足比例；风险/控制/指数规则也按其原含义记录，不表示买入强度。未知不填零。'};
  }
  function readRulePanel(panel, catalog, {code, day, at, recordedAt = null} = {}) {
    const out = {values: {}, evidence: {}, definitions: {}, coverage: {catalogRules: definitions(catalog).length, recordedRules: 0, measuredRules: 0, unknownRules: 0, missingConditions: 0}, rejected: []};
    if (!panel) return out;
    const defs = definitions(catalog), cutoff = instant(panel.cutoff), limit = instant(at), recorded = instant(recordedAt);
    const fail = reason => { out.rejected.push({reason}); return out; };
    if (!realEvidence(panel)) return fail('non-real-rule-observation');
    if (panel.schema !== PANEL || panel.semanticVersion !== SEMANTICS || panel.encoding !== 'ordinal-passed-failed-unknown-v1' || panel.code !== code || panel.day !== day ||
        cutoff === null || limit === null || cutoff > limit || recordedAt !== null && (recorded === null || recorded > limit || cutoff > recorded) ||
        typeof panel.dictionaryVersion !== 'string' || !panel.dictionaryVersion || panel.catalogFingerprint !== fingerprint(defs) ||
        panel.source !== 'shortline-condition-evaluator' || !panel.settings || typeof panel.settings !== 'object' || Array.isArray(panel.settings) ||
        panel.settingsFingerprint !== fingerprint(panel.settings) ||
        !Array.isArray(panel.rules) || panel.rules.length !== defs.length || !Array.isArray(panel.inputs) || panel.inputs.length > 3000)
      return fail('invalid-rule-observation-schema-or-time');
    if (panel.inputs.some(row => !sourceScope(row,code,day))) return fail('invalid-rule-input-scope-or-date');
    const provenance = panel.inputs.length > 0 && panel.inputs.every(row => realEvidence(row) && row.sourceRecordsReal === true && typeof row.source === 'string' && row.source.trim() &&
      instant(row.knownAt) !== null && instant(row.knownAt) <= cutoff && row.sourceTimesValid === true &&
      Number.isSafeInteger(row.records) && row.records > 0 && /^[a-f0-9]{64}$/.test(row.evidenceFingerprint || '') &&
      (row.sourceAt === null || instant(row.sourceAt) !== null && instant(row.sourceAt) <= instant(row.knownAt)));
    const used = new Set();
    for (const rule of panel.rules) {
      const def = defs.find(row => row.factorCode === rule.factorCode);
      if (!def || used.has(def.factorCode) || typeof rule.states !== 'string' || rule.states.length !== def.conditions.length ||
          !/^[pf?]*$/.test(rule.states) || !rule.sources || typeof rule.sources !== 'object' || Array.isArray(rule.sources)) {
        out.rejected.push({factorId: rule.factorCode, reason: 'invalid-rule-definition'}); continue;
      }
      used.add(def.factorCode); out.coverage.recordedRules++;
      if ([...rule.states].some((state,i) => state === '?' ? Object.hasOwn(rule.sources,i+1) : typeof rule.sources[i+1] !== 'string' || !rule.sources[i+1].trim()) ||
          Object.keys(rule.sources).some(key => !/^[1-9]\d*$/.test(key) || Number(key) > rule.states.length)) {
        out.rejected.push({factorId: def.factorCode, reason: 'invalid-rule-condition-evidence'}); continue;
      }
      const unknown = [...rule.states].filter(value => value === '?').length, matched = [...rule.states].filter(value => value === 'p').length;
      out.coverage.missingConditions += unknown;
      const complete = def.conditions.length > 0 && !unknown && provenance;
      const value = complete ? matched / def.conditions.length * 100 : null;
      if (rule.value !== value) {
        out.rejected.push({factorId: def.factorCode, reason: 'rule-value-does-not-match-evidence'}); continue;
      }
      if (!complete) { out.coverage.unknownRules++; continue; }
      const measuredDefinition = {...def, settingsVersion: panel.settingsVersion, settingsFingerprint: panel.settingsFingerprint};
      out.values[def.factorCode] = value; out.definitions[def.factorCode] = measuredDefinition; out.coverage.measuredRules++;
      out.evidence[def.factorCode] = {factorCode: def.factorCode, symbol: code, tradeDate: day, value, unit: def.unit,
        semanticVersion: SEMANTICS, definition: measuredDefinition, definitionFingerprint: fingerprint(measuredDefinition), dictionaryVersion: panel.dictionaryVersion,
        source: panel.source, knownAt: recorded ?? cutoff, observationCutoff: cutoff, catalogFingerprint: panel.catalogFingerprint,
        conditions: [...rule.states].map((state,i) => ({ordinal:i+1,name:def.conditions[i],status:state==='p'?'passed':state==='f'?'failed':'unknown',source:rule.sources[i+1]||null})),
        inputs: clone(panel.inputs), sampleSet: 'real'};
    }
    return out;
  }
  function numericDefinition(id, item) {
    return item?.definition || {factorCode: id, semanticVersion: item?.semanticVersion || 'source-numeric-value-v1', unit: item?.unit};
  }
  function readNumericCheck(check, catalog, at, {requireRecorded = true} = {}) {
    const end = instant(at), recorded = instant(check?.createdAt), cutoff = instant(check?.asOf);
    if (!realEvidence(check) || end === null || cutoff === null || cutoff > end || requireRecorded && (recorded === null || recorded > end || cutoff > recorded))
      return {values: {}, evidence: {}, definitions: {}, rejected: [{reason: 'check-not-known-at-decision'}]};
    const out = readRulePanel(check.recognition?.ruleObservations, catalog, {code: check.code, day: check.date, at: end, recordedAt: requireRecorded ? check.createdAt : null});
    if (out.rejected.length) { out.values = {}; out.evidence = {}; out.definitions = {}; }
    for (const [id,item] of Object.entries(check.factorObservations || {})) {
      // YZ numeric meaning belongs to the complete versioned panel, never to a
      // boolean factorCodes tag or a caller-supplied number using the same name.
      if (id.startsWith('YZ-')) continue;
      const known = instant(item?.knownAt);
      if (!/^[A-Z]{2,12}-\d{2,3}$/.test(id) || item.factorCode !== id || item.symbol !== check.code || item.tradeDate !== check.date ||
          !finite(item.value) || typeof item.unit !== 'string' || !item.unit || typeof item.source !== 'string' || !item.source ||
          known === null || known > Math.min(end,recorded ?? cutoff) || !realEvidence(item) ||
          item.definition && (item.definition.factorCode !== id || item.definition.unit !== item.unit || !item.definition.semanticVersion)) continue;
      out.values[id] = item.value; out.definitions[id] = numericDefinition(id,item); out.evidence[id] = clone(item);
    }
    return out;
  }
  function projectNumeric(values, model, defs = null) {
    const out = {};
    for (const p of model.parameters || []) {
      if (!finite(values?.[p.factorId]) || defs && stable(defs[p.factorId]) !== stable(model.definitions[p.factorId]) ||
          p.projections.some(row => !finite(out[row.factorId]))) continue;
      let value = (values[p.factorId] - p.center) / p.scale;
      for (const row of p.projections) value -= row.coefficient * out[row.factorId];
      value /= p.residualScale;
      if (finite(value)) out[p.factorId] = value;
    }
    return out;
  }
  function sealModel(model) { const out = clone(model); delete out.fingerprint; out.fingerprint = fingerprint(out); return out; }
  function validModel(model) {
    if (!model || model.schema !== MODEL || !Array.isArray(model.parameters) || !model.parameters.length || model.parameters.length > 95 ||
        !model.definitions || !model.weights || !/^[a-f0-9]{64}$/.test(model.fingerprint || '')) return false;
    const copy = {...model}; delete copy.fingerprint;
    if (fingerprint(copy) !== model.fingerprint) return false;
    const seen = new Set();
    for (const p of model.parameters) {
      if (seen.has(p.factorId) || !model.definitions[p.factorId] || model.definitions[p.factorId].factorCode !== p.factorId ||
          typeof model.definitions[p.factorId].unit !== 'string' || !model.definitions[p.factorId].unit || !finite(model.weights[p.factorId]) ||
          !finite(p.center) || !finite(p.scale) || p.scale <= 1e-12 || !finite(p.residualScale) || p.residualScale <= 1e-8 ||
          !Array.isArray(p.projections) || p.projections.some(row => !seen.has(row.factorId) || !finite(row.coefficient))) return false;
      seen.add(p.factorId);
    }
    return Object.keys(model.weights).length === seen.size;
  }
  function numericScore(model, vector) {
    if (!validModel(model)) return {score: null, missing: ['获批数值模型或指纹无效']};
    const values = projectNumeric(vector?.values, model, vector?.definitions || {}), ids = model.parameters.map(row => row.factorId);
    const missing = ids.filter(id => !finite(values[id]));
    return {score: missing.length ? null : ids.reduce((sum,id) => sum + values[id] * model.weights[id],0) / Math.sqrt(ids.length),
      residuals: values, missing, modelFingerprint: model.fingerprint};
  }
  function fitNumericModel(rows, {dictionaryVersion, trainCutoff, minRows = 12, maxFactors = 12} = {}) {
    const usable = rows.filter(row => row.numericFactors && finite(row.pnl)), byId = new Map();
    for (const row of usable) for (const id of Object.keys(row.numericFactors.values)) {
      const def = row.numericFactors.definitions[id]; if (!def) continue;
      if (!byId.has(id)) byId.set(id,{definition: def, count: 0, conflicted: false});
      const item = byId.get(id); item.count++; item.conflicted ||= stable(item.definition) !== stable(def);
    }
    const possible = [...byId].filter(([,v]) => !v.conflicted && v.count >= minRows && v.count >= usable.length * .8)
      .sort((a,b) => b[1].count-a[1].count || a[0].localeCompare(b[0]));
    let complete = usable; const selected = [];
    for (const [id] of possible) {
      const next = complete.filter(row => finite(row.numericFactors.values[id]));
      if (next.length < minRows) continue;
      selected.push(id); complete = next; if (selected.length === maxFactors) break;
    }
    if (!selected.length || complete.length < minRows) return null;
    const parameters = [], basis = [], suppressed = [], weights = {}, defs = {};
    const yMean = mean(complete.map(row => row.pnl));
    for (const id of selected) {
      const xs = complete.map(row => row.numericFactors.values[id]), center = mean(xs), scale = Math.sqrt(mean(xs.map(v => (v-center)**2)));
      if (!finite(scale) || scale <= 1e-12) { suppressed.push({factorId: id, reason: 'constant-training-factor'}); continue; }
      let values = xs.map(v => (v-center)/scale); const projections = [];
      for (const prior of basis) {
        const coefficient = mean(values.map((v,i) => v*prior.values[i]));
        values = values.map((v,i) => v-coefficient*prior.values[i]); projections.push({factorId: prior.id, coefficient});
      }
      const residualScale = Math.sqrt(mean(values.map(v => v*v)));
      if (!finite(residualScale) || residualScale <= 1e-8) { suppressed.push({factorId: id, reason: 'linearly-redundant-in-training'}); continue; }
      values = values.map(v => v/residualScale);
      const covariance = mean(values.map((v,i) => v*(complete[i].pnl-yMean)));
      const weight = Math.max(-3,Math.min(3,covariance*complete.length/(complete.length+8)));
      if (!finite(weight)) continue;
      parameters.push({factorId: id, center, scale, projections, residualScale}); basis.push({id,values});
      weights[id] = weight; defs[id] = clone(byId.get(id).definition);
    }
    if (!parameters.length) return null;
    return sealModel({schema: MODEL, dictionaryVersion, parameters, weights, definitions: defs, suppressed,
      trainCutoff, trainingRows: complete.length, sourceIds: complete.map(row => row.id),
      trainingSignalStart: complete.map(row => row.numericFactors.signalDay).filter(Boolean).sort()[0] || null,
      trainingSignalEnd: complete.map(row => row.numericFactors.signalDay).filter(Boolean).sort().at(-1) || null,
      trainingLabelKnownAtMax: Math.max(...complete.map(row => row.numericFactors.settlementKnownAt)),
      selection: {maxFactors,minRows,minObservedCoverage:.8,usesHoldoutPerformance:false},
      trainingFingerprint: fingerprint(complete.map(row => ({id: row.id, pnl: row.pnl, date: row.date, labelKnownAt: row.labelKnownAt, numericFactors: row.numericFactors}))),
      fit: 'train-only-orthogonal-net-settlement-covariance', regularization: {priorSamples: 8, maxAbsWeight: 3},
      target: 'verified-settlement-net-return-percent', productionWeightsChanged: false});
  }
  return Object.freeze({PANEL, SEMANTICS, MODEL, fingerprint, stable, instant, realEvidence, buildRulePanel, readRulePanel,
    readNumericCheck, numericDefinition, fitNumericModel, projectNumeric, numericScore, sealModel, validModel});
});
