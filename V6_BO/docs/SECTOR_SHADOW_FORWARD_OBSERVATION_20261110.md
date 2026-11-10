# V6 板块影子学习：冻结候选后的 3/5 交易日只读观察

**2026-11-10。** 与 PR #92 的 \`sector-shadow-candidate-not-training\` 只读预检衔接，但**不**把板块分数变化当作未来股票收益，也不把板块观察结论送入现有因子训练器。

## 研究边界

原链条能够在同一日期、合格的逐只股票原时点与已冻结行业名单上形成板块强度排名；这不是训练证据。新增纯函数 \`observeSectorShadowForward(preflight, archives, {tradeDates, asOf})\`，输入为：

1. 当天 \`inspectSectorShadowEligibility\` 返回且尚未训练的完整 \`preflight\` 对象。
2. 同日 **baseline** 档案，以及之后每天已合法取得、不可覆盖的 \`dated-sector-research-only\` 行情研究档案；未来数据必须逐天出现。
3. 明确列出的、升序的 A 股交易日日期序列（最多 30 天）。日期序列不是交易所日历签名，绝不能由自然日自动猜测。
4. \`asOf\` 研究时钟毫秒值；在截至该时钟尚未来临的交易日不得提前成熟。

读取者应从同一套私有归档读取资料，不需再次联网，不需接口账号，也不在本模块写入 JSON、权重、账户或通知；已有 \`sector-daily-chain\` 的预检/归档语义保持不变。

## 校验与输出

- 同日基础档案必须与已冻结候选的 **日期、源、分类版本、观察时点、全部排名行业的分数/广度/覆盖率/状态/排名** 相符；已回写/重造的候选与档案不一致则整个研究拒绝。
- 之后的 3、5 个交易日分别从候选交易日的**下一个明确交易日**开始算。缺任何一个，不进行跳日补样；将对应窗口标记 \`pending\`。
- 后续档案沿用已有 \`evaluateSectorRotation\` 的同源、同分类版本、日内时间对齐与各日覆盖判定，并额外核对行业成员数量相同、0–100 的合理评分/上涨广度、最低 80% 行业覆盖。来源冲突、时钟错位、重复日期等拒绝比较。
- 输出 \`threeSession\`、\`fiveSession\` 的逐行业 \`baselineScore\`、\`latestScore\`、\`scoreChange\`、\`baselineUpPct\`、\`latestUpPct\` 与此前定义的描述性轮动标签。个别行业不具可比性时为 \`unknown\`，不会将缺失日或停牌强填 0。
- 所有输出恒为 \`labelsAvailable:false\`、\`returnsAvailable:false\`、\`outOfSampleValidated:false\`、\`canTrain:false\`、\`canTrade:false\`、\`canNotify:false\`、\`autoPromotion:false\`、\`weightsChanged:false\`；即使3/5观察完成亦如此。

这是**描述性后续观察**：当天板块广度和分数来自成分股相对涨跌的等权代理，3/5 日跨时点的分数变化不是买入当天到未来卖出的可实现收益率，不能虚称 IC、收益预测或已经发生智能模型自主进化。下一阶段若要真正训练，必须额外冻结信号基准价、使用授权来源获取未来价格、根据公司行为/停牌与显式日历标记成熟、使用时间隔离样本外的真正收益标签与成本/风险检查，再进行人工审批的研究级权重实验。

## 验证

\`\`\`sh
cd V6_BO
node --check src/core/sector-shadow-forward-observer.js
node --test tests/sector-shadow-forward-observer.test.js tests/sector-shadow-learning-preflight.test.js tests/sector-rotation-history.test.js
npm run check
npm test
\`\`\`

专项测试覆盖完整五日、只够三日、缺中间交易日、同日候选被篡改、跨源/换分类版本、伪造评分、行业成员数变化、报价时钟错位、重复档案、非法交易日历和禁止训练的声明。合成用例仅证明代码协议，不证明真实行情和授权。回滚只需 revert 新增研究文件的 PR；两张锁定主页、四套策略、模拟盘、正式因子配置、其他历史归档均未触碰。