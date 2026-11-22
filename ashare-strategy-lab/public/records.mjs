import { normalizeCase } from './engine.mjs';

const DRAFT_KEY = 'ashare-strategy-lab:draft:v1';
const HISTORY_KEY = 'ashare-strategy-lab:history:v1';
let loadedHistory;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const caseGroups = ['stock', 'market', 'portfolio', 'evidence'];

function checkedCase(value) {
  if (!isObject(value) || !caseGroups.every(key => isObject(value[key]))) return null;
  try {
    return normalizeCase(value);
  } catch {
    return null;
  }
}

function isRecordList(value) {
  return Array.isArray(value) && value.every(record => isObject(record) &&
    typeof record.id === 'string' && typeof record.savedAt === 'string' &&
    isObject(record.environment) && typeof record.environment.label === 'string' &&
    (record.environment.reasons === undefined || isStringList(record.environment.reasons)) &&
    isObject(record.advice) && typeof record.advice.label === 'string' &&
    (record.advice.reasons === undefined || isStringList(record.advice.reasons)) &&
    isObject(record.summary) && isStringList(record.strategies) && isStringList(record.risks) &&
    checkedCase(record.case) !== null);
}

export function loadDraft() {
  try {
    const draft = JSON.parse(globalThis.localStorage.getItem(DRAFT_KEY));
    const caseData = checkedCase(draft?.case);
    return caseData ? {case: caseData, demo: draft.demo === true} : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  const caseData = checkedCase(draft?.case);
  if (!caseData) return false;
  try {
    globalThis.localStorage.setItem(DRAFT_KEY, JSON.stringify({case: caseData, demo: draft.demo === true}));
    return true;
  } catch {
    return false;
  }
}

export function loadRecords() {
  try {
    loadedHistory = globalThis.localStorage.getItem(HISTORY_KEY);
    const records = JSON.parse(loadedHistory);
    return isRecordList(records) ? records : [];
  } catch {
    return [];
  }
}

export function saveRecords(records) {
  if (!isRecordList(records)) return false;
  try {
    const storage = globalThis.localStorage;
    const current = storage.getItem(HISTORY_KEY);
    // Preserve unreadable history and detect changes from another tab before replacing it.
    if (loadedHistory !== undefined && current !== loadedHistory) return false;
    if (current !== null && !isRecordList(JSON.parse(current))) return false;
    const encoded = JSON.stringify(records);
    storage.setItem(HISTORY_KEY, encoded);
    loadedHistory = encoded;
    return true;
  } catch {
    return false;
  }
}

export function makeRecord(result, {demo = false} = {}) {
  const savedAt = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${savedAt}-${Math.random().toString(36).slice(2)}`,
    savedAt,
    demo: demo === true,
    // Keep the inputs and conclusions observed when this record was created.
    case: JSON.parse(JSON.stringify(result.case)),
    version: result.version,
    environment: {label: result.environment.label, level: result.environment.level,
      description: result.environment.description ?? '', reasons: [...(result.environment.reasons ?? [])]},
    advice: {label: result.advice.label, status: result.advice.status, capPct: result.advice.capPct,
      message: result.advice.message ?? '', reasons: [...(result.advice.reasons ?? [])]},
    summary: {...result.summary},
    strategies: result.rules.filter(rule => rule.kind === 'strategy' && rule.status === 'matched').map(rule => rule.name),
    risks: result.rules.filter(rule => rule.status === 'matched' && rule.clauses.some(clause =>
      clause.status === 'matched' && ['block', 'warn'].includes(clause.level))).map(rule => rule.name),
    outcomePct: null,
    note: ''
  };
}

export function recordsToJSON(records) {
  return JSON.stringify({schema: 'ashare-strategy-lab-reviews', version: 1,
    exportedAt: new Date().toISOString(), records}, null, 2) + '\n';
}

function csvCell(value) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '""';
  let content = String(value);
  // Spreadsheet programs can execute formula prefixes even in quoted CSV cells.
  if (typeof value !== 'number' && /^[\s\u0000-\u0020\u007f-\u009f\u200b-\u200d\u2060]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(content)) {
    content = "'" + content;
  }
  return '"' + content.replaceAll('"', '""') + '"';
}

export function recordsToCSV(records) {
  const rows = [[
    '保存时刻 UTC', '交易日期', '记录类型', '股票代码', '股票名称', '板块', '全A环境', '开仓提示',
    '模拟新增仓位上限 %', '匹配战法', '风险提示', '判断依据', '实际复盘涨跌幅 %', '复盘备注', '规则版本'
  ]];
  for (const record of records) {
    const stock = record.case.stock ?? {};
    rows.push([
      record.savedAt, stock.day, record.demo ? '演示' : '个人录入', stock.code, stock.name, stock.sector,
      record.environment.label, record.advice.label, record.advice.capPct, record.strategies.join('、'),
      record.risks.join('、'), record.advice.reasons?.join(' | '), record.outcomePct, record.note, record.version
    ]);
  }
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type: mime}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
