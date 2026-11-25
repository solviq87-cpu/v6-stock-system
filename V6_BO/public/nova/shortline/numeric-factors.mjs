import * as shared from './numeric-factors.js';
const api = shared.default || globalThis.FayoNumericFactorsV1;
export const {PANEL, SEMANTICS, MODEL, fingerprint, stable, instant, buildRulePanel, readRulePanel,
  readNumericCheck, numericDefinition, fitNumericModel, projectNumeric, numericScore, sealModel, validModel} = api;
