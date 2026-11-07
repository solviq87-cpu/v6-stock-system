# V6 网页研究终端（待验收草稿，未部署）

基于已合并的 V6 代码 `e3be4ceff9ff90408a0a1ebf4ebfb8b4baf19e31`，增加浏览器本地研究界面。原 bn 界面保留在 `dist/legacy.html`。现有线上站点未更新。

## 已实现

- 六个入口：总览、选股筛选、联动分析、因子诊断、模型对比、观察列表。
- 导入历史 JSON，在本机计算原有8项历史特征、成交额/波动率/量比条件、形态和RPS；可下载示例、导出分析报告。
- 对同源看涨证据分组去重，看跌风险单列；不同证据族不宣称统计独立。
- 逐日截面 Spearman RankIC、平均秩、五分位毛收益、有效覆盖率；仅计算已到期标签，缺失和常数截面不补成有效零值。
- 特征按信号收盘的获知时点隔离；如提供历史股票池，分别检查信号收盘和次日开盘资格。
- 读取离线模型比较报告；观察列表存于浏览器，支持备份恢复。导入数据不会上传。

## 从开源项目学习并落实的部分

- [Alphalens Reloaded](https://github.com/stefan-jansen/alphalens-reloaded)：借鉴截面因子检验定义，落实为独立的RankIC、分位收益和覆盖率分析；并列值取平均秩，不把常数因子当有效信号。没有声称已安装或移植整个库。
- [Qlib](https://github.com/microsoft/qlib)：借鉴统一研究口径、严格时点和基线比较。Alpha158的价量相关和趋势线性因子留待单独消融，当前未接入，原8项特征保持不变。
- [MASTER](https://github.com/SJTU-DMTai/MASTER) 与 [Qlib HIST](https://github.com/microsoft/qlib/tree/main/examples/benchmarks/HIST)：列为联动模型候选，尚未运行；需要历史概念映射及同步市场输入，不把当前规则分组冒充已训练图模型。

## 验证与使用

```sh
npm ci
npm test
npm run build
```

实际通过：13项因果/数据/统计测试、构建、前端语法检查，以及模拟DOM中的初始化、六路导航、因子表、SVG图和筛选提交。真实浏览器与手机视觉验收尚未完成：当前托管环境启用了桌面能力，但未提供 `cua_repl.js`（环境 `ccarenv_b64_Y2NhcmVudl9lNzI1NTdhYWY4NjQ4MTkxYmRjMDc4ZDgzZGYzNmQwZA`，desktop state unknown），按 Sites 流程没有另起预览服务器或替代浏览器控制路径。

构建输出为 `dist/`，可由静态服务器提供。默认是明确标识的确定性模拟样本；没有实时采集、后台模型训练、推送或真实下单。LightGBM/XGBoost须在原工程的Python环境训练后导入报告。这里的毛收益不能替代原工程含交易成本、T+1和可成交性约束的账本结果。

未运行完整市场的独立历史效果验证，未证明新条件提升收益。此草稿不改正式权重或原模拟账户状态，不包含私有配置、持仓、账户或密钥。后续按用户确认再验收和部署。
