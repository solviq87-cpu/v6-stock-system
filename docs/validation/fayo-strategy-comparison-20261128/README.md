# 原策略同条件回放：复用、接线和验收（候选，未发布）

源基线原#562 `baf2f520362f94aa3a81405620d145ab325ae918`，总管dev `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`。本批核对F09.1/F09.2/F12.1/F12.3/F12.4，落实原独立纸面组合的消费入口，不重新开发账户、策略引擎或审批。

## 逐项决定

|任务|决定及已做工作|边界及恢复条件|
|---|---|---|
|F09.1 趋势动量|保留/分层。原`strategies/a-share-strategy-pack.json`已有trend/momentum/breakout，`strategy-service.js → universe-scanner.js`消费；本批未新增战法或改阈值|这些研究族不等于原四体系，更不等于已验证生产策略。对应期限、点时股票池及独立净收益证据待补；不凭名称计完成|
|F09.2 反转修复|保留/深化。原pack已有reversal，并有`quality-volume-reversal-research.js`，复用而非新建模型|实际净收益、继续恶化负例及完整股票池仍待；本批不认领收益优势或单项验收|
|F12.1 统一竞技场|深化/接线。复用原`strategy-portfolio-lab.js`，在原CLI输出及原回测工作台增加原四体系同条件描述；同样本、资金、费用、退出模型，各自覆盖和共同已评估信号分报|仅四个旧体系的研究基准接线；未覆盖全部策略族、共同成熟收益标签、前向竞技和正式替换，不选赢家。本批新增局部证据，非完整签收|
|F12.3 分期限|保留原退出合同并分层。公开原入场后下一可执行交易日开盘退出，保留T+1/停牌/涨跌停导致的延后及未平仓估值|本批只有原退出模型，不能当1/3/5/10/20多期限已实现。多期限预注册与独立成熟样本仍待，不新增局部完成计数|
|F12.4 综合评价|复用已有净值、回撤、成交和阻断记录，完整执行证据随导出保留|尾损、容量、实际滑点、独立效用及统计可靠性未证明；原虚拟组合不是权威账户，不能将可见指标当准入或盈利证据|

F12.1原台账指向`factor-model-comparison.js`，该模块比较因子IC版本，不代表全部策略/费用公平竞争。本批将实际复用入口补为原独立组合、统一离线CLI和原`/api/research/complete-run`，保留因子对照原用途。

## 架构及真实消费者

- 原`strategy-portfolio-lab.js`只增加配置白名单和已计算结果的描述投影。原成交、资金、税费、最低佣金、整手、T+1、风险、停牌/限价函数未改。四体系仍按原规则各自评估，缺同日输入保持unknown。
- 原`runUnifiedStrategyProject`继续复用其已经计算的组合，追加`strategyComparison`，不重复回放。原完整实验仅在显式`includeStrategyComparison:true`时额外调用一次原独立组合；原默认回测/纸面/原生输出保持。非法开关拒绝，非法参数不回填默认，而将该组件标为不可用。
- 资金、成本及退出协议由同一配置供四体系消费；输入、信号、协议及各组合证据分别绑定指纹。各自覆盖与共同已评估信号是不同口径，均不是成熟盈利标签。没有排名、冠军选择、晋级、自动训练或权重修改。
- 原回测工作台`lab/backtest`增加“原策略同条件回放”。新组件只显示原计算值；未评估/无买入成交时不把现金未动的0收益显示成策略胜出。完整委托、成交、估值与版本信息随报告导出。超过40000条交互证据行时组件明确不可用、指向原离线CLI，不截取有利片段。原30秒worker与公共预算保持。
- 研究只读，所有交易/训练/通知/晋级权限为false。首次正式启用和生产发布仍走原唯一机制；本批没有实盘或生产使用授权。手工描述性回放尚未接通全部预注册、全策略试验预算和正式竞技晋级，不得作准入依据。

## 原始数据与时间真实性

复用2026-11-27已保存的新浪600000未复权日线120条，2026-06-04至11-27，源字节12250，SHA256 `897cc0471978459dca8f1f2d0f191fd9c77ad7a4d76f0b30e0f2ab6b645b1bf3`。原收件时点为1795794481090，供应商发布时间未知。未再次联网，也未将收件时点倒填为每个历史日已知。原始回执、base64字节和输入历史保留为`source-receipt.json`、`history.json`。

在内核禁网下，原`fetchResearchHistory`适配器重解码相同字节，120根数据与原存档逐项相同。离线CLI、原HTTP worker和实际双端UI均消费同一数据集/协议指纹。历史证券主数据、公司行为、点时因子、完整市场成分和持续用途许可未认证；来源不是独立验证后的交易价格。

原引擎对四体系各120条均unknown。原回放可入场窗口对应89个信号/体系，共同已评估信号0，均没有买入、卖出或实际收益。界面四行“未评估”，账面现金未动与策略有效性明确分离。该负面结果原样保留，不能靠补造快照产生好看的选股成绩。

## 本批实际验证

- 新增12项协议/展示行为，另增1项HTTP夹具UTF-8回归。关联33、内核禁网32通过。原夹具逐块解码可能截断中文字符，现合并字节后统一解码；同一逐字节响应测试修前失败、修后通过，保留完整强比较，生产响应未改。
- 原服务5项HTTP控制：默认无该组件；显式调用返回四体系描述；只读身份拒绝且无研究结果；非法布尔开关拒绝；非法成本组件不可用且原纸面输出保持。原`json(res,obj,req)`使用HTTP200承载部分业务拒绝，验证检查`ok/readOnly/result`，不把200当批准，也未改变旧HTTP协议。
- 原鉴权、原worker和真实Chromium 1366/390/320三宽通过。上传归档真实历史，实际点击新增入口，表格4行、共同0/89，各自未知89；实际读取`/api/state`后结果保持，手机横向可访问全部列，展开协议无横溢或脚本错误；三宽实际点击下载，完整四组合各89估值点与空委托/成交及输入指纹均核对，导出文件哈希见`exports-manifest.json`。截图为原软件，不是AI效果图；时钟受控，无真实持仓，不能当实际手机/实盘或大陆线路验收。
- 本批源完整原生8147/8147通过，零失败/取消/跳过，149413ms；源码指纹与原日志哈希见`full-summary.json`。最终代码SHA/CI与隔离组合均另验，不沿用旧版本绿灯。

## 复现与回退

在`V6_BO`，复用已有依赖：

```sh
FAYO_STUDY_RECEIPTS=/tmp/fayo-comparison-offline python tests/helpers/deny-network-connect.py node ../docs/validation/fayo-strategy-comparison-20261128/offline.cjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-comparison-ui node ../docs/validation/fayo-strategy-comparison-20261128/native.cjs
node --test tests/strategy-comparison-protocol.test.js tests/strategy-comparison-view.test.js tests/studio-fixture-utf8.test.js tests/strategy-portfolio-lab.test.js tests/unified-strategy-project.test.js tests/unified-run-audit.test.js tests/native-strategy-daily.test.js
npm run check
npm test
```

`python`需既有Playwright环境，Chromium固定`/usr/bin/chromium`。回退仅本批代码，不覆盖新账本、研究档案或历史版本；由原总管统一集成/发布。无新外部服务、模型、采集器、账户或通知链，未合dev、未部署。
