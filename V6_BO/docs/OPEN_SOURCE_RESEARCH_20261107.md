# 天枢智策（V6）开源参考第一轮审查 — 2026-11-07

## 已核验仓库及许可证（GitHub仓库根目录 LICENSE）
- [VeighNa/vn.py](https://github.com/vnpy/vnpy)：MIT。参考事件驱动、行情事件和模拟交易隔离；不引入券商实盘接口。
- [AKFamily/AKShare](https://github.com/akfamily/akshare)：MIT。参考A股行情获取与字段标准化；数据源的使用条款、稳定性仍需单独核验。
- [Microsoft/Qlib](https://github.com/microsoft/qlib)：MIT。参考研究数据集、训练/验证/测试切分、样本外评价；不直接替换现有选股引擎。
- [mementum/backtrader](https://github.com/mementum/backtrader)：GPL-3.0。**不得不经许可证兼容性审查就复制代码或合并到V6**；先只学习公开的架构概念，若需复用须明确履行GPL要求或采用独立自研实现。

## V6当前已核验的已有基础
- `V6_BO/scripts/eastmoney-historical-import.js`：历史日K线导入，拒绝覆盖已有输出。
- `V6_BO/src/core/eastmoney-historical-feed.js`：OHLCV校验、前复权标记、日历一致性检查；限制1~100股票。
- `V6_BO/scripts/continuous-research.js` + `src/core/continuous-research-ops.js`：检测输入文件变化、生成可复核研究档案；这不等于模型自主训练。
- 既有模拟盘功能需要独立测试，不能与实盘连接。

## 具体实施优先级
1. 审计并修复已有选股规则的缺失值、空规则误判；先补测试再修，防止负优化。
2. 建立日K/分钟K历史完整性与数据时点验收，明确停牌/复权/异常交易日处理。
3. 将推荐信号的原始时间戳、当时K线与后续1/3/5/10日表现关联，生成可审计记录。
4. 用历史回放和独立样本外评估验证候选指标（含支撑阻力公式）。
5. 验证模拟盘自动运行、虚拟成交、收益回撤、重复信号和异常断线恢复。
6. 对比基线并通过回归测试后才考虑启用新策略；不接实盘、不修改真实资金。

## 当前状态
本轮已完成四个仓库LICENSE核验和V6部分模块静态核对；尚未引入第三方源码，尚未完成完整回测/自动学习闭环、全量测试和部署。产品对外名称：天枢智策；内部仓库及代码名保持V6。
