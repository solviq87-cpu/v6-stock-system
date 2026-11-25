'use strict';

// Derived notification evidence. This store has no account mutation or transport
// capability: a reservation must precede the existing private push queue.
const fs = require('node:fs'), path = require('node:path');
const {withAccountLock} = require('./account-process-lock');
const {privateRoot, canonical, digest} = require('./research-workspace-store');
const {atomicWrite} = require('./market-data-center');
const {riskState,copyStateEvidence,lastValidRisk,resolutionCheck,reductionCheck}=require('./risk-state-contract');
const MAX_GROUPS = 2000, MAX_EVENTS = 20000, MAX_BYTES = 32 * 1024 * 1024;
const COOLDOWN_MS = 120000, QUEUE_CONFIRMATION_MS = 30000, MAX_DAILY_SENDS = 12;
const LEVEL = {unknown: 0, info: 1, warning: 2, critical: 3};
const EVIDENCE = new Set(['available', 'partial', 'missing', 'stale', 'conflict', 'unknown']);
const DELIVERY = new Set(['queued', 'gateway-accepted', 'gateway-rejected', 'unconfirmed', 'receiver-confirmed']);
const clone = value => JSON.parse(JSON.stringify(value));
const timeOk = value => Number.isSafeInteger(value) && value > 0 && value < 8e15;
const textOk = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value);
const dayOf = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const classOf = severity => severity === 'critical' ? 'critical' : 'general';

// The original sender exposes {ok,msg}; raw provider errors are deliberately not
// copied to the derived archive because they can contain private channel data.
function normalizeRiskReceipt(result) {
  const r = result && typeof result === 'object' ? result : {}, message = String(r.msg || r.message || '');
  const uncertain = result instanceof Error || ['unknown', 'unconfirmed', 'pending-unknown'].includes(r.status) ||
    /结果未知|未确认|超时|未回调|timeout|timed?\s*out|ETIMEDOUT|socket|ECONN|EPIPE|ENOTFOUND|EAI_AGAIN|EHOST|ENET|网络异常|请求失败|Premature|aborted|回执.*矛盾|HTTP\s+(?:408|5\d\d)\b/i.test(message);
  const accepted = ['accepted', 'gateway-accepted'].includes(r.status) || r.ok === true;
  const rejected = ['rejected', 'gateway-rejected'].includes(r.status) || r.notSent === true || r.blocked === true || Boolean(r.localReview) ||
    /(?:^|\s)HTTP\s+4\d\d\b|code=-?[1-9]\d*\b|未配置|未发送|被丢弃|私密通道配置已变更|签名密钥异常|请求构造失败|无法发起网络请求/i.test(message);
  const conflict = accepted && (rejected || r.ok === false);
  const status = uncertain || conflict ? 'unconfirmed' : accepted ? 'gateway-accepted' : rejected ? 'gateway-rejected' : 'unconfirmed';
  return {status, gatewayAccepted: status === 'gateway-accepted', receiverConfirmed: false,
    reason: status === 'gateway-accepted' ? '原私密通道收到网关受理回执，尚无接收端确认' :
      status === 'gateway-rejected' ? '原私密通道明确拒绝或本次尚未外发，保留事件及原限制' : '未取得确定投递回执，保留预留且不自动重发'};
}

function identity(input) {
  if (!textOk(input?.accountId, 120) || !textOk(input?.accountEpoch, 240)) throw Error('风险提醒缺少原账户及期间标识');
  return {accountId: input.accountId, accountEpoch: input.accountEpoch};
}

function strings(value, field) {
  if (!Array.isArray(value) || value.length > 40 || value.some(item => !textOk(item, 1200))) throw Error('风险提醒' + field + '无效');
  return [...new Set(value)];
}

function normalizeRisk(row, now) {
  if (!row || !textOk(row.id, 240) || !textOk(row.rootCauseId, 240) || !textOk(row.category, 80) ||
      !textOk(row.object?.type, 80) || !textOk(row.object?.id, 240) || !Object.hasOwn(LEVEL, row.severity) ||
      !EVIDENCE.has(row.evidenceStatus) || !textOk(row.executionStatus, 120) ||
      !['active', 'resolved', 'unknown'].includes(row.status) ||
      !(row.sourceAt === null || timeOk(row.sourceAt)) || !textOk(row.source, 240) || !textOk(row.impact, 1200))
    throw Error('风险提醒行缺少对象、根因、证据或执行状态');
  const facts = strings(row.facts || (row.fact ? [row.fact] : []), '事实');
  if (!facts.length) throw Error('风险提醒必须包含具体事实');
  const sourceUsable = row.evidenceStatus === 'available' && timeOk(row.sourceAt) && row.sourceAt <= now;
  // A missing row, old price or "no alert" is never evidence of resolution.
  const status = row.status === 'resolved' && !sourceUsable ? 'unknown' : row.status;
  const references = {};
  for (const field of ['planId', 'observationId', 'alertId', 'entryEventId', 'ruleId', 'policyVersion', 'strategyVersion', 'inputVersion', 'kind'])
    if (textOk(row.references?.[field], 240)) references[field] = row.references[field];
  if (Array.isArray(row.references?.orderIds)) references.orderIds = strings(row.references.orderIds, '订单引用');
  const normalized={id: row.id, rootCauseId: row.rootCauseId, category: row.category,
    object: {type: row.object.type, id: row.object.id, label: textOk(row.object.label, 240) ? row.object.label : row.object.id},
    severity: row.severity, evidenceStatus: row.evidenceStatus, executionStatus: row.executionStatus,
    facts, sourceAt: row.sourceAt, source: row.source, impact: row.impact,
    restrictions: strings(row.restrictions || [], '限制'), checks: strings(row.checks || [], '检查项'),
    releaseConditions: strings(row.releaseConditions || [], '解除条件'), status,
    priceDependent: row.priceDependent === true, references,
    followUp: textOk(row.followUp, 1200) ? row.followUp : null,
    relatedRiskIds: Array.isArray(row.relatedRiskIds) ? strings(row.relatedRiskIds, '关联证据') : [row.id],
    sources: Array.isArray(row.sources) ? row.sources.slice(0, 40).map(source => ({
      source: textOk(source?.source, 240) ? source.source : '来源未知', sourceAt: timeOk(source?.sourceAt) ? source.sourceAt : null})) : [],
    planId: textOk(row.planId, 240) ? row.planId : null, orderId: textOk(row.orderId, 240) ? row.orderId : null,
    eventId: textOk(row.eventId, 240) ? row.eventId : null,...copyStateEvidence(row)};
  return canonical({...normalized,...riskState(normalized,now)});
}

function groupRows(rows) {
  const grouped = new Map(), ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw Error('风险提醒行标识重复');
    ids.add(row.id);
    const group = grouped.get(row.rootCauseId) || [];
    group.push(row); grouped.set(row.rootCauseId, group);
  }
  return [...grouped].map(([rootCauseId, risks]) => {
    risks.sort((a, b) => a.id.localeCompare(b.id));
    const severity = [...risks].sort((a, b) => LEVEL[b.severity] - LEVEL[a.severity])[0].severity;
    const status = risks.every(row => row.status === 'resolved') ? 'resolved' :
      risks.some(row => row.status === 'active') ? 'active' : 'unknown';
    const evidenceStatus = risks.every(row => row.evidenceStatus === 'available') ? 'available' :
      ['conflict', 'stale', 'missing', 'unknown', 'partial'].find(value => risks.some(row => row.evidenceStatus === value));
    return {rootCauseId, severity, classification: classOf(severity), status, evidenceStatus, risks,
      riskLevel:Math.max(0,...risks.map(row=>row.riskLevel||0))||null,
      assessmentState:status==='resolved'?'not-triggered':risks.some(row=>row.assessmentState==='risk-detected')?'risk-detected':'unable-to-assess'};
  }).sort((a, b) => a.rootCauseId.localeCompare(b.rootCauseId));
}

function createRiskAlertLifecycle({root, clock = Date.now, canWrite = () => false} = {}) {
  const dir = privateRoot(root);
  if (typeof clock !== 'function' || typeof canWrite !== 'function') throw Error('风险提醒存储配置无效');
  const nowOf = () => { const now = clock(); if (!timeOk(now)) throw Error('风险提醒时钟无效'); return now; };
  const allowed = () => { if (canWrite() !== true) throw Error('仅原主实例可更新风险提醒证据'); };
  const fileOf = key => path.join(dir, 'risk-alerts-' + digest(key) + '.json');
  function load(key) {
    privateRoot(root);
    let fd, value;
    try {
      fd = fs.openSync(fileOf(key), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > MAX_BYTES) throw Error('风险提醒文件权限或容量无效');
      value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {schemaVersion: 1, ...key, revision: 0, updatedAt: null,
        preferences: {generalMutedUntil: null, criticalMutedUntil: null}, preferenceEvents: [], groups: [], deliveries: []};
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    const {fingerprint, ...state} = value;
    if (fingerprint !== digest(state) || state.schemaVersion !== 1 || state.accountId !== key.accountId || state.accountEpoch !== key.accountEpoch ||
        !Number.isSafeInteger(state.revision) || state.revision < 1 || !timeOk(state.updatedAt) ||
        !Array.isArray(state.groups) || state.groups.length > MAX_GROUPS || !Array.isArray(state.deliveries) || state.deliveries.length > MAX_EVENTS ||
        !Array.isArray(state.preferenceEvents) || state.preferenceEvents.length > MAX_EVENTS ||
        !state.preferences || Object.values(state.preferences).some(value => value !== null && !timeOk(value)))
      throw Error('风险提醒证据完整性校验失败，禁止释放去重');
    const groupIds = new Set(), deliveryIds = new Set(); let eventCount = 0;
    for (const group of state.groups) {
      if (!textOk(group.rootCauseId) || groupIds.has(group.rootCauseId) || !hashOk(group.id) ||
          !Object.hasOwn(LEVEL, group.severity) || !Object.hasOwn(LEVEL, group.maxSeverity) ||
          !['active', 'resolved', 'unknown'].includes(group.status) || !EVIDENCE.has(group.evidenceStatus) ||
          !timeOk(group.firstSeenAt) || !timeOk(group.lastSeenAt) || group.lastSeenAt < group.firstSeenAt ||
          !Number.isSafeInteger(group.revision) || group.revision < 1 || !Array.isArray(group.risks) || !Array.isArray(group.events) || !group.events.length ||
          !group.viewedBy || typeof group.viewedBy !== 'object') throw Error('风险提醒根因记录损坏');
      groupIds.add(group.rootCauseId); eventCount += group.events.length;
      for (const row of group.risks) normalizeRisk(row, state.updatedAt);
      for (const event of group.events) if (!hashOk(event.id) || !timeOk(event.at) ||
        !['first-seen', 'escalated', 'resolved', 'reopened'].includes(event.kind)) throw Error('风险提醒生命周期损坏');
      if(group.levelChanges!==undefined){
        if(!Array.isArray(group.levelChanges))throw Error('风险降级历史格式无效');
        eventCount+=group.levelChanges.length;
        for(const change of group.levelChanges){
          if(!hashOk(change.id)||change.kind!=='deescalated'||!timeOk(change.at)||
            ![1,2,3,4].includes(change.from)||![1,2,3,4].includes(change.to)||change.to>=change.from||
            !hashOk(change.evidenceFingerprint)||!Array.isArray(change.evidence)||
            digest(change.evidence)!==change.evidenceFingerprint)throw Error('风险降级历史损坏');
          for(const row of change.evidence)normalizeRisk(row,change.at);
        }
      }
      if(group.notificationAdmission&&(!hashOk(group.notificationAdmission.eventId)||!timeOk(group.notificationAdmission.at)||
        !['daily-limit','cooldown'].includes(group.notificationAdmission.status)||!textOk(group.notificationAdmission.reason,600)||
        !(group.notificationAdmission.retryAt===null||timeOk(group.notificationAdmission.retryAt))))throw Error('提醒通道限额回执损坏');
      if(group.lastValidRisk&&(!timeOk(group.lastValidRisk.sourceAt)||![1,2,3,4].includes(group.lastValidRisk.riskLevel)||
        !Array.isArray(group.lastValidRisk.risks)||!group.lastValidRisk.risks.length))throw Error('上次有效风险证据损坏');
      // Upgrade the derived view in memory only. Evaluate old evidence at its
      // recorded observation time, never at this restart's wall clock.
      if(!Object.hasOwn(group,'lastValidRisk')){
        const at=group.lastSeenAt;
        group.lastValidRisk=lastValidRisk(group.risks.map(row=>normalizeRisk(row,at)),at);
      }
    }
    if (eventCount > MAX_EVENTS) throw Error('风险提醒事件数量超限');
    for (const delivery of state.deliveries) {
      if (!hashOk(delivery.id) || deliveryIds.has(delivery.id) || !hashOk(delivery.eventId) ||
          !DELIVERY.has(delivery.status) || !timeOk(delivery.queuedAt) || !timeOk(delivery.updatedAt) ||
          !Array.isArray(delivery.receipts) || delivery.receipts.length > 16 ||
          !state.groups.some(group => group.rootCauseId === delivery.rootCauseId && group.events.some(event => event.id === delivery.eventId)))
        throw Error('风险提醒投递记录损坏');
      deliveryIds.add(delivery.id);
    }
    return state;
  }
  function save(state, now) {
    if (state.updatedAt !== null && now < state.updatedAt) throw Error('风险提醒时钟回退，保留原记录');
    if (state.groups.length > MAX_GROUPS || state.deliveries.length > MAX_EVENTS ||
        state.groups.reduce((n, group) => n + group.events.length + (group.levelChanges?.length||0), 0) > MAX_EVENTS) throw Error('风险提醒证据已达上限，请归档；原记录不删');
    state.revision++; state.updatedAt = now;
    const raw = JSON.stringify({...state, fingerprint: digest(state)}) + '\n';
    if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('风险提醒证据已达容量，保留原记录');
    allowed(); atomicWrite(fileOf(identity(state)), raw);
  }
  function locked(key, fn) {
    allowed(); privateRoot(root, true);
    return withAccountLock(fileOf(key), () => { allowed(); return fn(load(key)); });
  }
  function deliveryView(delivery, now) {
    if (!delivery) return {status: 'not-queued', gatewayAccepted: false, receiverConfirmed: false, deliveryId: null};
    const status = delivery.status === 'queued' && now - delivery.queuedAt > QUEUE_CONFIRMATION_MS ? 'unconfirmed' : delivery.status;
    return {...clone(delivery), status, deliveryId: delivery.id,
      gatewayAccepted: ['gateway-accepted', 'receiver-confirmed'].includes(delivery.status),
      receiverConfirmed: delivery.status === 'receiver-confirmed',
      note: status === 'unconfirmed' ? '未取得确定回执，原预留保留且不自动重发' :
        status === 'gateway-accepted' ? '仅网关受理，尚无接收端确认' : status === 'receiver-confirmed' ? '已有可追溯接收端确认' :
          status === 'queued' ? '已持久预留并等待原队列回执，尚不能确认送达' : '网关拒绝，原事件保留且不无限重发'};
  }
  function view(state, actor) {
    const now = nowOf(), actorKey = textOk(actor, 240) ? digest(actor) : null;
    const groups = state.groups.map(group => {
      const event = group.events.at(-1), delivery = state.deliveries.find(row => row.eventId === event.id);
      const admission=!delivery&&group.notificationAdmission?.eventId===event.id?group.notificationAdmission:null;
      const categoryMute = state.preferences[group.classification + 'MutedUntil'];
      const mutedUntil = Math.max(group.mutedUntil || 0, categoryMute || 0) || null;
      const viewed = actorKey ? group.viewedBy[actorKey] || null : null;
      return {...clone(group), viewedBy: undefined, viewedAt: viewed?.at || null,
        viewed: Boolean(viewed && viewed.revision === group.revision), mutedUntil, muted: mutedUntil > now,
        notificationEventId: event.id, notification: {...deliveryView(delivery, now),
          admissionStatus:admission?.status||null,admissionReason:admission?.reason||null,
          admissionAt:admission?.at||null,retryAt:admission?.retryAt||null,automaticTransportRetry:false},restrictionsStillApply: true,
        stationVisible: true, notificationOnlyMute: true};
    }).sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || LEVEL[b.severity] - LEVEL[a.severity] || b.lastSeenAt - a.lastSeenAt);
    return {schemaVersion: 1, ...identity(state), revision: state.revision, updatedAt: state.updatedAt,
      groups, preferences: clone(state.preferences), notificationCandidates: groups.filter(group => !group.muted && group.notification.status === 'not-queued'&&group.notificationSuppressedEventId!==group.notificationEventId)
        .map(group => ({rootCauseId: group.rootCauseId, eventId: group.notificationEventId, classification: group.classification})),
      preferencesUpdatedAt: state.preferenceEvents.at(-1)?.at || null,
      canTrade: false, ledgerOwned: false, receiverConfirmationSupported: false};
  }
  function read(input) { return view(load(identity(input)), input?.actor); }
  function eventFor(state, group, kind, now) {
    const event = {id: digest([state.accountId, state.accountEpoch, group.rootCauseId, group.events.length + 1, kind]),
      kind, at: now, severity: group.severity, evidenceStatus: group.evidenceStatus, riskIds: group.risks.map(row => row.id),
      riskLevel:group.riskLevel??null,assessmentState:group.assessmentState||'unable-to-assess',
      evidenceFingerprint: digest(group.risks), evidence: clone(group.risks)};
    group.events.push(event);group.notificationSuppressedEventId=null;return event;
  }
  function observe(input) {
    const key = identity(input), now = input.observedAt ?? nowOf();
    if (!timeOk(now) || now > nowOf() || nowOf() - now > 15000 || !Array.isArray(input.risks) || input.risks.length > 5000 ||
        input.complete !== undefined && typeof input.complete !== 'boolean') throw Error('风险观察时点或批次无效');
    const next = groupRows(input.risks.map(row => normalizeRisk(row, now)));
    return locked(key, state => {
      if (state.updatedAt !== null && now < state.updatedAt) throw Error('风险观察时点倒序');
      let changed = false; const present = new Set();
      for (let incoming of next) {
        present.add(incoming.rootCauseId);
        let group = state.groups.find(row => row.rootCauseId === incoming.rootCauseId);
        if (!group) {
          // Do not invent a historical incident from an initial all-clear row.
          if (incoming.status === 'resolved') continue;
          group = {...incoming, id: digest([key, incoming.rootCauseId]), firstSeenAt: now, lastSeenAt: now, lastCheckedAt: now,
            maxSeverity: incoming.severity, revision: 1, occurrence: 1, observationGap: false, resolvedAt: null,
            maxRiskLevel:incoming.riskLevel,lastValidRisk:lastValidRisk(incoming.risks,now),resolutionBlockedReason:null,
            resolutionBaselineAt:Math.max(0,...incoming.risks.map(row=>timeOk(row.sourceAt)&&row.sourceAt<=now?row.sourceAt:0))||now,
            mutedUntil: null, viewedBy: {}, events: [],levelChanges:[]};
          eventFor(state, group, 'first-seen', now); state.groups.push(group); changed = true; continue;
        }
        const oldStatus = group.status, oldMax = group.maxSeverity,oldRiskLevel=group.riskLevel||group.lastValidRisk?.riskLevel||null;
        const oldMaxRiskLevel=group.maxRiskLevel||group.lastValidRisk?.riskLevel||0;
        let resolutionBlockedReason=null;
        if(oldStatus!=='resolved'&&incoming.status==='resolved'){
          const checked=resolutionCheck(incoming,group.lastValidRisk||{risks:group.risks,
            sourceAt:group.resolutionBaselineAt||Math.max(0,...group.risks.map(row=>timeOk(row.sourceAt)&&row.sourceAt<=now?row.sourceAt:0))||group.firstSeenAt},now);
          if(!checked.allowed){resolutionBlockedReason=checked.reason;
            incoming=groupRows(incoming.risks.map(row=>normalizeRisk({...row,status:'unknown'},now)))[0];}
        }
        if(oldStatus!=='resolved'&&incoming.status==='active'&&group.lastValidRisk&&incoming.riskLevel!==null&&
          incoming.riskLevel<group.lastValidRisk.riskLevel){
          const checked=reductionCheck(incoming,group.lastValidRisk,now);
          if(!checked.allowed){resolutionBlockedReason='不能确认风险降级：'+checked.reason;
            incoming=groupRows(incoming.risks.map(row=>normalizeRisk({...row,status:'unknown'},now)))[0];}
        }
        const sameEvidence = digest({risks: group.risks, status: group.status, observationGap: group.observationGap}) ===
          digest({risks: incoming.risks, status: incoming.status, observationGap: false});
        if (sameEvidence && group.lastSeenAt === now) continue;
        const withoutTimes=(value,fields)=>value?Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key))):value;
        const comparable = risks => risks.map(({sourceAt,dataAt,sources,...row}) => ({...row,
          riskContract:withoutTimes(row.riskContract,['sourceAt','dataAt']),
          authorityEvidence:withoutTimes(row.authorityEvidence,['observedAt']),
          actionEvidence:withoutTimes(row.actionEvidence,['checkedAt']),
          recoveryEvidence:withoutTimes(row.recoveryEvidence,['checkedAt']),
          sources: sources.map(({source}) => source)}));
        const meaningfulChange = digest({risks: comparable(group.risks), status: oldStatus, observationGap: group.observationGap}) !==
          digest({risks: comparable(incoming.risks), status: incoming.status, observationGap: false});
        Object.assign(group, incoming, {lastSeenAt: now, lastCheckedAt: now, observationGap: false,resolutionBlockedReason});
        const currentValid=lastValidRisk(incoming.risks,now);
        if(currentValid&&(!group.lastValidRisk||currentValid.sourceAt>=group.lastValidRisk.sourceAt))group.lastValidRisk=currentValid;
        if (meaningfulChange) group.revision++;
        if (oldStatus === 'resolved' && incoming.status !== 'resolved') {
          group.occurrence++; group.maxSeverity = incoming.severity;group.maxRiskLevel=incoming.riskLevel; group.resolvedAt = null;
          eventFor(state, group, 'reopened', now);
        } else if (oldStatus !== 'resolved' && incoming.status === 'resolved') {
          group.resolvedAt = now; eventFor(state, group, 'resolved', now);
        } else if (incoming.status !== 'resolved' && (LEVEL[incoming.severity] > LEVEL[oldMax]||(incoming.riskLevel||0)>oldMaxRiskLevel||
          oldRiskLevel!==null&&incoming.riskLevel>oldRiskLevel)) {
          if(LEVEL[incoming.severity]>LEVEL[oldMax])group.maxSeverity = incoming.severity;
          group.maxRiskLevel=Math.max(oldMaxRiskLevel,incoming.riskLevel||0)||null;
          const event=eventFor(state,group,'escalated',now);
          event.bypassGeneralCooldown=LEVEL[incoming.severity]>LEVEL[oldMax]||incoming.riskLevel>=3;
        } else if(incoming.status!=='resolved'&&incoming.riskLevel!==null&&oldRiskLevel!==null&&incoming.riskLevel<oldRiskLevel&&currentValid){
          // Keep the original notification-event enum readable by #359.
          // A lower grade is history, not a new outward notification event.
          group.levelChanges=group.levelChanges||[];
          group.levelChanges.push({id:digest([key,group.rootCauseId,'deescalated',group.levelChanges.length+1]),
            kind:'deescalated',at:now,from:oldRiskLevel,to:incoming.riskLevel,
            evidenceFingerprint:digest(group.risks),evidence:clone(group.risks)});
          group.notificationSuppressedEventId=group.events.at(-1).id;
        }
        changed = true;
      }
      if (input.complete === true) for (const group of state.groups) {
        if (present.has(group.rootCauseId) || group.status === 'resolved') continue;
        if (!group.observationGap) { group.revision++; changed = true; }
        group.observationGap = true; group.status = 'unknown'; group.evidenceStatus = 'missing'; group.lastCheckedAt = now;
        group.riskLevel=null;group.assessmentState='unable-to-assess';group.resolutionBlockedReason='后续观察缺档，保留上次有效风险及原限制';
      }
      if (changed) save(state, now);
      return {...view(state, input.actor), changed};
    });
  }
  function editable(state, input) {
    if (!textOk(input.actor, 240) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== state.revision)
      throw Error('风险提醒查看者或版本冲突，请刷新后重试');
  }
  function findGroup(state, rootCauseId) {
    const group = state.groups.find(row => row.rootCauseId === rootCauseId);
    if (!group) throw Error('风险提醒根因不存在'); return group;
  }
  function markViewed(input) {
    return locked(identity(input), state => {
      editable(state, input); const group = findGroup(state, input.rootCauseId), now = nowOf(), actorKey = digest(input.actor);
      if (group.viewedBy[actorKey]?.revision !== group.revision) {
        if (Object.keys(group.viewedBy).length >= 200 && !group.viewedBy[actorKey]) throw Error('风险查看记录达到上限');
        group.viewedBy[actorKey] = {at: now, revision: group.revision}; save(state, now);
      }
      return view(state, input.actor);
    });
  }
  function setMuted(input) {
    return locked(identity(input), state => {
      editable(state, input); const now = nowOf(), until = input.mutedUntil;
      if (!(until === null || timeOk(until) && until > now) || Boolean(input.rootCauseId) === Boolean(input.classification))
        throw Error('静音范围或截止时间无效');
      if (input.rootCauseId) findGroup(state, input.rootCauseId).mutedUntil = until;
      else {
        if (!['general', 'critical'].includes(input.classification)) throw Error('静音分类无效');
        state.preferences[input.classification + 'MutedUntil'] = until;
      }
      if (state.preferenceEvents.length >= MAX_EVENTS) throw Error('静音变更证据达到上限');
      state.preferenceEvents.push({at: now, actor: digest(input.actor), rootCauseId: input.rootCauseId || null,
        classification: input.classification || null, mutedUntil: until});
      save(state, now); return view(state, input.actor);
    });
  }
  function reserveDelivery(input) {
    return locked(identity(input), state => {
      const now = nowOf(), group = findGroup(state, input.rootCauseId), event = group.events.at(-1);
      if (input.eventId !== undefined && input.eventId !== event.id) return {reserved: false, status: 'superseded', deliveryId: null};
      if (input.expectedRiskFingerprint !== undefined && input.expectedRiskFingerprint !== digest(group.risks))
        return {reserved: false, status: 'superseded-evidence', deliveryId: null};
      const previous = state.deliveries.find(row => row.eventId === event.id);
      if (previous) return {reserved: false, ...deliveryView(previous, now), eventId: event.id};
      if (group.observationGap) return {reserved: false, status: 'observation-gap', deliveryId: null};
      if (group.notificationSuppressedEventId===event.id) return {reserved: false, status: 'deescalated', deliveryId: null};
      const mutedUntil = Math.max(group.mutedUntil || 0, state.preferences[group.classification + 'MutedUntil'] || 0);
      if (mutedUntil > now) return {reserved: false, status: 'muted', deliveryId: null, mutedUntil};
      const today = state.deliveries.filter(row => dayOf(row.queuedAt) === dayOf(now) && row.classification === group.classification);
      const limited=(status,reason,retryAt=null)=>{
        const record={eventId:event.id,status,reason,retryAt};
        const prior=group.notificationAdmission;
        if(!prior||digest({...prior,at:undefined})!==digest(record)){
          group.notificationAdmission={...record,at:now};save(state,now);
        }
        return {reserved:false,status,deliveryId:null,reason,retryAt};
      };
      if (today.length >= MAX_DAILY_SENDS) return limited('daily-limit','原私密通道本分类每日限额已达到；本事件未排队、未发送，站内风险及限制继续保留');
      const last = today.at(-1);
      if (last && now - last.queuedAt < COOLDOWN_MS && !(event.kind==='escalated'&&event.bypassGeneralCooldown!==false) && group.classification !== 'critical')
        return limited('cooldown','原私密通道普通提醒冷却中；本事件未排队、未发送，严重升级不受普通冷却延迟',last.queuedAt + COOLDOWN_MS);
      const delivery = {id: digest([event.id, 'private-original-queue']), eventId: event.id, rootCauseId: group.rootCauseId,
        classification: group.classification, status: 'queued', queuedAt: now, updatedAt: now, receipts: [],
        attemptsReserved: 1, transport: 'original-private-push-chain'};
      state.deliveries.push(delivery); save(state, now);
      return {reserved: true, ...deliveryView(delivery, now), eventId: event.id, group: view(state).groups.find(row => row.rootCauseId === group.rootCauseId)};
    });
  }
  function recordReceipt(input) {
    if (!hashOk(input.deliveryId) || !DELIVERY.has(input.status) || input.status === 'queued') throw Error('风险投递回执无效');
    return locked(identity(input), state => {
      const now = nowOf(), delivery = state.deliveries.find(row => row.id === input.deliveryId);
      if (!delivery) throw Error('风险投递缺少持久预留');
      let evidence = null;
      if (input.status === 'receiver-confirmed') {
        const source = input.evidence;
        if (!source || !textOk(source.receiptId, 240) || !textOk(source.source, 240) || !timeOk(source.receivedAt) ||
            source.receivedAt < delivery.queuedAt || source.receivedAt > now || source.trustedReceiver !== true)
          throw Error('接收端确认必须有可信来源、回执编号和实际接收时点');
        evidence = {receiptId: source.receiptId, source: source.source, receivedAt: source.receivedAt, trustedReceiver: true};
      }
      const reason = textOk(input.reason, 600) ? input.reason : null;
      const receipt = {status: input.status, at: now, evidence, reason};
      if (delivery.receipts.some(row => row.status === receipt.status && digest(row.evidence) === digest(evidence) && row.reason === reason))
        return {recorded: false, ...deliveryView(delivery, now)};
      if (delivery.receipts.length >= 16) throw Error('同一通知回执达到上限，保留原预留');
      delivery.receipts.push(receipt); delivery.updatedAt = now;
      // A late timeout cannot erase acceptance or a real receipt. Contradictory
      // definite gateway results remain uncertain and retain the reservation.
      if (delivery.status !== 'receiver-confirmed') {
        if (input.status === 'receiver-confirmed') delivery.status = input.status;
        else if (delivery.receipts.some(row => row.status === 'gateway-accepted') && delivery.receipts.some(row => row.status === 'gateway-rejected'))
          delivery.status = 'unconfirmed';
        else if (delivery.status !== 'gateway-accepted' || input.status !== 'unconfirmed') delivery.status = input.status;
      }
      save(state, now); return {recorded: true, ...deliveryView(delivery, now)};
    });
  }
  return {read, observe, markViewed, setMuted, reserveDelivery, recordReceipt};
}

module.exports = {createRiskAlertLifecycle, normalizeRisk, groupRows, normalizeRiskReceipt, COOLDOWN_MS, QUEUE_CONFIRMATION_MS, MAX_DAILY_SENDS};
