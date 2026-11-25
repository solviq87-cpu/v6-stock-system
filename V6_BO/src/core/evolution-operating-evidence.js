'use strict';

// Read the existing operators' receipts. A research GET must never invoke their
// schedulers, create a report, submit feedback, or write an observation.
const path = require('node:path');
const {aShareCalendarDate} = require('./a-share-calendar');
const {createPaperExecutionReportStore} = require('./paper-execution-report-store');
const {createFeedbackRunStore} = require('../server/decision-feedback-runtime');
const {createPaperPlanObservationStore} = require('./paper-plan-observation-store');

async function readEvolutionOperatingEvidence({root, asOf = Date.now()} = {}) {
  if (!Number.isSafeInteger(asOf) || asOf <= 0 || asOf > Date.now()) throw Error('研究运行证据时点无效');
  const day = aShareCalendarDate(asOf), workflowSources = {};
  const result = {executionReports: [], feedbackRuns: [], planObservations: [], workflowSources};
  const unavailable = (name, reason) => { workflowSources[name] = {status: 'unavailable', day, reason}; };
  try {
    const reports = createPaperExecutionReportStore({root: path.join(root, 'execution-reports')});
    const report = reports.read({day, asOf});
    if (report.status === 'observed') result.executionReports.push(report);
    workflowSources.executionReports = {status: report.status, day, count: result.executionReports.length,
      reason: report.status === 'observed' ? null : '原执行日报尚无该时点已知的版本'};
  } catch { unavailable('executionReports', '原执行日报路径或证据完整性未通过核验，未生成替代报告'); }
  try {
    const feedback = createFeedbackRunStore({root: path.join(root, 'feedback-runs')}).read({now: asOf});
    result.feedbackRuns = feedback.results;
    workflowSources.feedbackRuns = {status: feedback.results.length ? 'observed' : feedback.attempts.length ? 'pending' : 'missing',
      day, count: feedback.results.length, attempts: feedback.attempts.length,
      pending: feedback.attempts.filter(attempt => !feedback.results.some(row => row.attemptHash === attempt.hash)).length,
      reason: feedback.results.length ? null : feedback.attempts.length ? '原反馈已有尝试，尚无已完成回执' : '原反馈尚无该时点已知的回执'};
  } catch { unavailable('feedbackRuns', '原反馈档案路径或证据完整性未通过核验，未触发新的验证提交'); }
  try {
    // The original reader verifies the whole immutable chain. Filter the
    // verified receipts afterwards; never pass a later snapshot as an old tick.
    const observations = await createPaperPlanObservationStore({root: path.join(root, 'plan-observations')}).read({day});
    result.planObservations = observations.records.filter(row => row.observedAt <= asOf && row.receivedAt <= asOf && row.quoteAt <= asOf);
    workflowSources.planObservations = {status: result.planObservations.length ? 'observed' : 'missing', day,
      count: result.planObservations.length, reason: result.planObservations.length ? null : '原计划观察尚无该时点已知的报价回执'};
  } catch { unavailable('planObservations', '原计划观察链未通过核验，未使用未验证价格'); }
  return result;
}

module.exports = {readEvolutionOperatingEvidence};
