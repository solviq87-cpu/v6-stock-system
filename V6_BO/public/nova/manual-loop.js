// Private manual evidence, rendered over the shared server journal on every device.
export function renderManualLoop(ctx, ui) {
  const {
    el,
    action,
    panel,
    field,
    input,
    select,
    notice,
    table,
    privateView,
    request,
    form,
    asyncRegion,
  } = ui;
  if (ctx.role !== 'edit') return privateView();
  const endpoint = '/api/research/manual-loop',
    money = (c) => (c === null ? '—' : (c / 100).toFixed(2)),
    price = (n) => (n / 10000).toFixed(4);
  const date = (n) =>
    new Date(n).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });
  const outcomes = {
    'closed-with-deviations': '已平仓，存在执行偏差',
    'closed-user-reconciled': '已平仓，用户对账一致',
    'not-executed': '未执行',
  };
  const eventLabels = {
    freeze: '冻结建议',
    fill: '人工成交',
    'void-fill': '作废成交',
    'not-executed': '记为未执行',
    reconcile: '交割对账',
    review: '冻结复盘',
    reopen: '重开纠错',
    propose: '冻结候选',
    validate: '候选验证',
  };
  const labels = {
    frozen: '待执行',
    holding: '持有中',
    'needs-reconciliation': '待对账',
    reconciled: '已对账',
    reviewed: '已复盘',
    'not-executed': '未执行',
  };
  let selectedId = null;
  const region = asyncRegion(
    ctx,
    async () => {
      const loop = await request(ctx, endpoint);
      return { loop: loop.result };
    },
    ({ loop }, reload) => {
      if (ctx.role !== 'edit') return privateView();
      const host = el('div', {
        class: 'fy-stack',
        'data-manual-loop': true,
        'data-loop-revision': loop.revision,
      });
      // Keep the same id and revision after an ambiguous timeout. A retry must not
      // create a second fill. Revision conflicts require an explicit fresh read.
      const send = () => {
        let pending;
        return async (body) => {
          if (ctx.signal?.aborted || ctx.role !== 'edit')
            throw Error('编辑身份已结束，请重新登录');
          const key = JSON.stringify(body);
          if (!pending || pending.key !== key)
            pending = {
              key,
              body: {
                ...body,
                expectedRevision: loop.revision,
                requestId: 'loop_' + crypto.randomUUID(),
              },
            };
          const reply = await request(ctx, endpoint, {
            method: 'POST',
            body: pending.body,
          });
          if (body.action === 'freeze') selectedId = reply.result?.recordId;
          if (!ctx.signal?.aborted) await reload();
          return reply;
        };
      };
      host.append(
        panel(
          '人工执行与复盘',
          '服务端共享记录 · 用户自行申报，未经券商认证',
          notice(
            `已冻结 ${loop.summary.frozen} · 未执行 ${loop.summary.notExecuted} · 已复盘 ${loop.summary.reviewed}`,
          ),
          action('重新读取', reload),
        ),
      );
      const runs = loop.research?.rows || [];
      if (runs.length) {
        const submit = send();
        host.append(
          form(
            '冻结一条建议',
            '从已归档研究选择；数量和价格是人工计划，风控尚未放行。',
            [
              field(
                '研究版本',
                select(
                  'runId',
                  runs.map((r) => [
                    r.id,
                    `${r.symbol} ${r.name || ''} · ${r.tradeDate || date(r.recordedAt)}`,
                  ]),
                ),
              ),
              field(
                '计划股数',
                input('shares', '', 'number', {
                  required: true,
                  min: 1,
                  max: 10000000,
                  step: 1,
                }),
              ),
              field(
                '买价上限',
                input('limitPrice', '', 'number', {
                  required: true,
                  min: '0.0001',
                  step: '0.0001',
                }),
              ),
            ],
            '冻结建议',
            (data) =>
              submit({
                action: 'freeze',
                runId: String(data.get('runId')),
                shares: Number(data.get('shares')),
                limitPrice: String(data.get('limitPrice')),
              }),
          ),
        );
      } else
        host.append(
          notice(
            loop.research?.status === 'unavailable'
              ? '原研究档案不可用；已有执行记录仍保留，暂不能冻结新建议。'
              : '尚无研究归档。先在研究空间完成一次研究，再冻结执行建议。',
          ),
        );
      const plans = loop.plans || [];
      if (!plans.length) return host;
      const selected = plans.find((p) => p.id === selectedId) || plans[0];
      selectedId = selected.id;
      const picker = select(
          'selectedPlan',
          plans.map((p) => [
            p.id,
            `${p.symbol} · ${date(p.frozenAt)} · ${labels[p.status] || p.status}`,
          ]),
          selectedId,
        ),
        detail = el('div', { class: 'fy-stack' });
      host.append(field('选择建议', picker), detail);
      function paint(p) {
        selectedId = p.id;
        detail.replaceChildren();
        const policy = p.risk.policy,
          policyText = Object.entries(policy)
            .map(
              ([k, v]) =>
                ({
                  stopPct: '止损',
                  reducePct: '减仓',
                  takePct: '止盈',
                  maxPosPct: '总仓上限',
                })[k] + ` ${v}%`,
            )
            .join(' · ');
        detail.append(
          panel(
            `${p.symbol} ${p.name} · ${labels[p.status]}`,
            '建议、原配置和研究版本已冻结',
            notice(
              `计划 ${p.shares} 股 / 买价 ≤ ${price(p.limitPriceUnits)}；${policyText || '原配置缺失'}`,
            ),
            notice(p.risk.reason),
            notice(
              `选股：${p.roles.selection.map((s) => (s.label || s.id) + '（' + ({ pass: '通过', fail: '未通过', unknown: '证据不足' }[s.verdict] || s.verdict || '证据不足') + '）').join('、') || '证据不足'}；行情：${p.roles.regime === 'unknown' ? '证据不足' : typeof p.roles.regime === 'string' ? p.roles.regime : '见原研究'}；仓位：人工计划，未验证`,
            ),
            notice(
              `已记录持仓 ${p.totals.quantity} 股 · 买入含费 ${money(p.totals.buyCents)} 元 · 卖出扣费 ${money(p.totals.sellCents)} 元 · 平仓净额 ${money(p.totals.netPnlCents)} 元`,
            ),
            p.totals.deviations.length &&
              notice('执行偏差：' + p.totals.deviations.join('；')),
          ),
        );
        if (p.fills.length)
          detail.append(
            panel(
              '逐笔成交',
              '实际发生时间与费用；不向券商下单',
              table(
                [
                  ['编号', (f) => f.reference],
                  ['方向', (f) => (f.side === 'buy' ? '买入' : '卖出')],
                  ['股数', (f) => f.quantity],
                  ['价格', (f) => price(f.priceUnits)],
                  ['全部费用/元', (f) => money(f.feeCents)],
                  ['成交时间', (f) => date(f.executedAt)],
                  [
                    '纠错',
                    (f) =>
                      p.review
                        ? '复盘已冻结'
                        : action('作废此笔', () => {
                            const submit = send();
                            detail.prepend(
                              form(
                                '追加纠错记录',
                                '原成交保留，作废后须重新对账。',
                                [
                                  field(
                                    '原因',
                                    input('reason', '', 'text', {
                                      required: true,
                                      maxlength: 500,
                                    }),
                                  ),
                                ],
                                '确认作废',
                                (data) =>
                                  submit({
                                    action: 'void-fill',
                                    planId: p.id,
                                    fillId: f.id,
                                    reason: String(data.get('reason')),
                                  }),
                              ),
                            );
                          }),
                  ],
                ],
                p.fills,
              ),
            ),
          );
        if (!p.review && !p.notExecuted) {
          if (!p.fills.length || p.totals.quantity > 0) {
            const submit = send();
            detail.append(
              form(
                '登记人工成交',
                '按时间顺序回填券商实际成交。费用填该笔佣金、税和其他费用合计；编号须全局唯一。',
                [
                  field(
                    '成交编号',
                    input('reference', '', 'text', {
                      required: true,
                      maxlength: 80,
                      pattern: '[A-Za-z0-9_.:-]+',
                    }),
                  ),
                  field(
                    '方向',
                    select('side', [
                      ['buy', '买入'],
                      ['sell', '卖出'],
                    ]),
                  ),
                  field(
                    '股数',
                    input('quantity', '', 'number', {
                      required: true,
                      min: 1,
                      step: 1,
                    }),
                  ),
                  field(
                    '成交价格',
                    input('price', '', 'number', {
                      required: true,
                      min: '0.0001',
                      step: '0.0001',
                    }),
                  ),
                  field(
                    '全部费用/元',
                    input('fee', '', 'number', {
                      required: true,
                      min: 0,
                      step: '0.01',
                    }),
                  ),
                  field(
                    '实际成交时间（北京时间）',
                    input('executedAt', '', 'datetime-local', {
                      required: true,
                      step: 1,
                    }),
                  ),
                ],
                '保存成交',
                (data) =>
                  submit({
                    action: 'fill',
                    planId: p.id,
                    fill: {
                      reference: String(data.get('reference')),
                      side: String(data.get('side')),
                      quantity: Number(data.get('quantity')),
                      price: String(data.get('price')),
                      fee: String(data.get('fee')),
                      executedAt:
                        String(data.get('executedAt')).replace(
                          /^(.*T\d{2}:\d{2})$/,
                          '$1:00',
                        ) + '+08:00',
                    },
                  }),
              ),
            );
          }
          if (!p.fills.length) {
            const submit = send();
            detail.append(
              form(
                '记为未执行',
                '保留未执行原因，避免只留下成功成交。',
                [
                  field(
                    '原因',
                    input('reason', '', 'text', {
                      required: true,
                      maxlength: 500,
                    }),
                  ),
                ],
                '保存未执行',
                (data) =>
                  submit({
                    action: 'not-executed',
                    planId: p.id,
                    reason: String(data.get('reason')),
                  }),
              ),
            );
          }
          if (p.fills.length) {
            const submit = send();
            detail.append(
              form(
                '核对交割记录',
                '从独立保存的交割记录粘贴 JSON 数组，逐字段核对编号、方向、股数、价格、费用和时间。此处不认证券商来源。',
                [
                  field(
                    '来源说明',
                    input('sourceLabel', '', 'text', {
                      required: true,
                      maxlength: 80,
                    }),
                  ),
                  field(
                    '交割记录 JSON',
                    el('textarea', {
                      class: 'fy-input',
                      name: 'rows',
                      required: true,
                      rows: 7,
                      maxlength: 60000,
                      placeholder:
                        '[{"reference":"成交编号","side":"buy","quantity":100,"price":"10.00","fee":"5.00","executedAt":"2026-11-16T10:00:00+08:00"}]',
                    }),
                  ),
                ],
                '逐字段对账',
                (data) =>
                  submit({
                    action: 'reconcile',
                    planId: p.id,
                    statement: {
                      sourceLabel: String(data.get('sourceLabel')),
                      rows: JSON.parse(String(data.get('rows'))),
                    },
                  }),
              ),
            );
          }
        }
        if (p.reconciliation)
          detail.append(
            notice(
              p.reconciliation.matched
                ? '交割记录逐字段一致（用户申报）'
                : '交割记录不一致，不能完成复盘。',
            ),
          );
        if (
          !p.review &&
          (p.notExecuted ||
            (p.totals.quantity === 0 && p.reconciliation?.matched))
        ) {
          const submit = send();
          detail.append(
            form(
              '冻结复盘',
              '平仓净额已扣除全部申报费用；未执行不估算收益。',
              [
                field(
                  '复盘结论',
                  el('textarea', {
                    class: 'fy-input',
                    name: 'note',
                    required: true,
                    rows: 3,
                    maxlength: 1000,
                  }),
                ),
              ],
              '冻结复盘',
              (data) =>
                submit({
                  action: 'review',
                  planId: p.id,
                  note: String(data.get('note')),
                }),
            ),
          );
        }
        if (p.review) {
          detail.append(
            panel(
              '已冻结复盘',
              date(p.review.recordedAt),
              notice(p.review.note),
              notice(
                `净额 ${money(p.review.result.netPnlCents)} 元 · ${outcomes[p.review.result.outcome] || '证据不足'}`,
              ),
            ),
          );
          const submit = send();
          detail.append(
            form(
              '提交验证候选',
              '只研究样本数、先验强度和筛选概率。训练末日不早于今天，验证和样本外须用新的未来区间；通过后仍需生产门禁。',
              [
                field(
                  '改进假设',
                  el('textarea', {
                    class: 'fy-input',
                    name: 'hypothesis',
                    required: true,
                    rows: 3,
                    maxlength: 1000,
                  }),
                ),
                ...[
                  ['minimumSamples', '最低样本数', 20, 20, 200, 1],
                  ['priorStrength', '先验强度', 2, 2, 100, 1],
                  ['minUpProbability', '最低上行概率', 0.5, 0.5, 0.9, 0.01],
                  ['minClosedTrades', '最低平仓样本', 3, 3, 10000, 1],
                  ['maxDrawdownPct', '研究最大回撤/%', 10, 0.01, 50, 0.01],
                  ['minReturnPct', '最低收益/%', 0, 0, 100, 0.01],
                  ['minExcessReturnPct', '最低超额收益/%', 0, 0, 100, 0.01],
                  ['costStressBps', '额外成本/bps', 10, 10, 100, 1],
                ].map(([name, label, value, min, max, step]) =>
                  field(
                    label,
                    input(name, value, 'number', {
                      required: true,
                      min,
                      max,
                      step,
                    }),
                  ),
                ),
                ...[
                  ['trainEnd', '训练末日'],
                  ['validationEnd', '验证末日'],
                  ['holdoutEnd', '样本外末日'],
                ].map(([name, label]) =>
                  field(label, input(name, '', 'date', { required: true })),
                ),
              ],
              '冻结候选与协议',
              (data) => {
                const n = (k) => Number(data.get(k));
                return submit({
                  action: 'propose',
                  planId: p.id,
                  hypothesis: String(data.get('hypothesis')),
                  parameters: {
                    learningConfig: {
                      minimumSamples: n('minimumSamples'),
                      priorStrength: n('priorStrength'),
                    },
                    selectionPolicy: {
                      minUpProbability: n('minUpProbability'),
                    },
                  },
                  protocol: {
                    trainEnd: String(data.get('trainEnd')),
                    validationEnd: String(data.get('validationEnd')),
                    holdoutEnd: String(data.get('holdoutEnd')),
                    gates: Object.fromEntries(
                      [
                        'minClosedTrades',
                        'maxDrawdownPct',
                        'minReturnPct',
                        'minExcessReturnPct',
                        'costStressBps',
                      ].map((k) => [k, n(k)]),
                    ),
                  },
                });
              },
            ),
          );
        }
        if (p.review || p.notExecuted) {
          const submit = send();
          detail.append(
            form(
              '重开以纠错',
              '保留旧复盘及候选历史；原候选失效，纠错后重新对账。',
              [
                field(
                  '重开原因',
                  input('reason', '', 'text', {
                    required: true,
                    maxlength: 500,
                  }),
                ),
              ],
              '追加重开记录',
              (data) =>
                submit({
                  action: 'reopen',
                  planId: p.id,
                  reason: String(data.get('reason')),
                }),
            ),
          );
        }
        if (p.candidates.length)
          detail.append(
            panel(
              '验证候选',
              '固定原策略和风控；参数不会自动启用',
              table(
                [
                  ['改进假设', (c) => c.hypothesis],
                  ['样本外末日', (c) => c.protocol.holdoutEnd],
                  [
                    '状态',
                    (c) =>
                      c.reviewId !== p.review?.id
                        ? '原复盘已重开，候选失效'
                        : c.validation?.status === 'research-validated'
                          ? '研究验证通过，生产未放行'
                          : c.validation?.status === 'rejected'
                            ? '验证拒绝'
                            : '等待冻结期及私有数据',
                  ],
                  [
                    '验证',
                    (c) =>
                      c.reviewId === p.review?.id && !c.validation
                        ? action('运行冻结验证', async () => {
                            const result = notice('验证中…');
                            detail.append(result);
                            try {
                              await send()({
                                action: 'validate',
                                planId: p.id,
                                candidateId: c.id,
                              });
                            } catch (e) {
                              result.textContent = e.message;
                            }
                          })
                        : '—',
                  ],
                ],
                p.candidates,
              ),
            ),
          );
        detail.append(
          el(
            'details',
            { class: 'fy-details' },
            el('summary', {}, '不可变记录轨迹'),
            table(
              [
                ['时间', (e) => date(e.recordedAt)],
                ['动作', (e) => eventLabels[e.type] || '历史记录'],
                ['说明', (e) => e.reason || e.note || '—'],
              ],
              p.history,
            ),
          ),
        );
      }
      picker.addEventListener('change', () =>
        paint(plans.find((p) => p.id === picker.value)),
      );
      paint(selected);
      return host;
    },
  );
  ctx.onState?.(() => {
    if (ctx.role !== 'edit') region.replaceChildren(privateView());
  });
  return region;
}
