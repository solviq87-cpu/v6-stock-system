# V6 网页策略研究终端（已发布）

基于已合并的 `6bead0b78792323848a16806f2d3115171127095`，增加完整策略研究和浏览器本地模拟。原 bn 界面保留在 `dist/legacy.html`，现有线上站点已于2026-11-08更新，保留原有私有访问范围。

## 已实现

- 默认进入策略研究，另有总览、筛选、联动、因子、模型对比和观察列表，共七个入口。
- 三套完整研究策略：Donchian20/10趋势突破、RSI2顺势回归、20日动量TopK轮动。分别展示入场、持有、退出、风险预算与来源；历史模拟保存交易、受阻事件、权益和期末持仓，计入简化费用与T+1限制。
- 核对六项候选的来源与证据，当前三套为可运行研究变体；vn.py两套及ETF双动量列为后续候选。均未找到对应本实现的独立核验实盘净业绩，不把模拟胜率称为实盘准确率。详见[策略设计与边界](docs/STRATEGY_RESEARCH.md)、[来源核对报告](docs/STRATEGY_SOURCE_REVIEW_20261108.md)。
- 导入历史 JSON，在本机计算原有8项历史特征、成交额/波动率/量比条件、形态和RPS；可下载示例、导出分析报告。
- 对同源看涨证据分组去重，看跌风险单列；不同证据族不宣称统计独立。
- 逐日截面 Spearman RankIC、平均秩、五分位毛收益、有效覆盖率；仅计算已到期标签，缺失和常数截面不补成有效零值。
- 特征按信号收盘的获知时点隔离；如提供历史股票池，分别检查信号收盘和次日开盘资格。
- 读取离线模型比较报告；观察列表存于浏览器，支持备份恢复。导入数据不会上传。

## 从开源项目学习并落实的部分

- [Alphalens Reloaded](https://github.com/stefan-jansen/alphalens-reloaded)：借鉴截面因子检验定义，落实为独立的RankIC、分位收益和覆盖率分析；并列值取平均秩，不把常数因子当有效信号。没有声称已安装或移植整个库。
- [Qlib](https://github.com/microsoft/qlib)：借鉴持仓与候选联合排序、有限换仓和最低持有期，落实为20日动量轮动变体；不是Qlib模型预测或收益认证。原8项特征保持不变。
- [Donchian通道](https://www.backtrader.com/recipes/indicators/donchian/donchian/)与[Connors RSI2规则](https://tradingmarkets.com/recent/how_to_enter_and_exit_a_position_on_the_close-677551)：根据公式独立实现完整日线只做多研究变体，采用明确的下一开盘与风险适配，不复制不明许可策略代码。
- [MASTER](https://github.com/SJTU-DMTai/MASTER) 与 [Qlib HIST](https://github.com/microsoft/qlib/tree/main/examples/benchmarks/HIST)：列为联动模型候选，尚未运行；需要历史概念映射及同步市场输入，不把当前规则分组冒充已训练图模型。

## 验证与使用

```sh
npm ci
npm run build
npm test
```

实际通过：40项测试（13项原分析、2项界面价格时点、22项策略状态/资金/时序、3项策略页面集成）、构建及前端语法检查。集成测试验证三套实际模拟结果、手动筛选不改变策略样本、导入新数据取消旧结果；价格、K线和观察价格仍共用引擎筛过的日线。真实浏览器/手机视觉验收尚未完成：当前环境未提供 `cua_repl.js`（环境 `ccarenv_b64_Y2NhcmVudl9lNzI1NTdhYWY4NjQ4MTkxYmRjMDc4ZDgzZGYzNmQwZA`，desktop state unknown），没有用DOM测试冒充浏览器验收，也未另起替代预览路径。

构建输出为 `dist/`。默认是明确标识的260日确定性模拟样本；没有实时采集、后台模型训练、推送或真实下单。LightGBM/XGBoost仍需在原工程Python环境训练后导入报告。因子页显示毛收益，策略页为简化成交及成本模型的模拟净结果，不能当作原工程完整账本或实盘结果。

未运行完整市场的独立历史效果验证，未证明策略收益改善。不改正式权重和原模拟账户状态，不包含私有配置、持仓、账户或密钥。当前发布状态见下方记录。

## 当前发布记录

- 网址：https://v6-stock-bn-preview.mythiclatch2.chatgpt.site
- 状态：Sites 返回 `succeeded`，2026-11-08。
- GitHub合并提交：`2c6509d530b4751e0ddfcac96223d5f01406473a`；CI验证代码：`f84f20f53112af38a9d2ba3a3d57ec585db07b3a`。
- Sites源码提交：`5d809989e58687b5f9bc44e643db76c1a1b7bff9`，发布包SHA-256：`0e90f0bf6082d06215e44730e6eaaf2c81cfb27151248495bea12a4f92df624a`。
- Site项目：`appgprj_6aee0b82f2848191b846023eafa4349c`；保存版本：`appgprj_6aee0b82f2848191b846023eafa4349c~appgver_1c66c279982c81918d552c6e6e5d5a02`；部署：`appgdep_6af00b5d4b348191a9677f90a9f814c4`。
- 回滚：重新部署原保存版本 `appgprj_6aee0b82f2848191b846023eafa4349c~appgver_0a0720787ab88191bbb3aa798b576264`；不修改访问范围或浏览器本地观察记录。

上面的开发设计文档保留了发布前检查范围；本节为当前发布状态。默认示例非实时行情，`liveVerified:false`，没有实盘收益认证。
