# 模型逻辑改进与开源方案比较（20261107bs）

基线：`dev@d827da333ed76633c3daeed840d3269124b6b41e`。本次范围是离线选股研究工具，不连接实盘；原有股票池、战法、持仓提醒和模拟盘逻辑保持原入口。界面/服务缓存版本同步为 `20261107bs`。

## 已修复和增加的条件

1. **历史股票池一致性**：模型训练和预测现在都检查信号收盘时已知的 `universeHistory`。训练标签还检查次日开盘时已知的成员资格，不能用当天稍晚披露的信息补资格。以前账本过滤了非成员，训练却仍可能受其影响。缺少历史表时保持旧输入兼容，明确输出 `legacy-unverified`；提供表也不等于来源已获认证。
2. **按信号时点筛选**：新增可选 `modelFilters`，在生成训练和预测样本之前使用。20日平均成交额不足/未知、20日波动率超限、量比不足/过高均可拒绝。没有内置“最佳阈值”，默认不开启这些新条件。
3. **复用原有流动性门禁**：`minPriorTurnover` 现在同时约束信号样本及原有账本开仓。`maxParticipationPct` 仍由账本控制实际模拟成交数量，需要明确 `volumeUnit: "shares"`；不拿一笔虚拟固定成交量来筛训练样本。
4. **公平比较**：显式新条件同时应用于模型、动量、低波、中国价值（有合格财务输入时）及原V6对照。费用、滑点、T+1、涨跌停和风险策略仍走同一套独立账本。比较增加某条件的效果，需要冻结数据分别运行“无条件”和“单一条件”，不能只看筛选后的结果。
5. **可核查输出**：`sampleAudit` 分别记录训练/评估样本数和拒绝原因；一个样本可触发多个原因，原因计数不能直接相加当作被拒绝样本数。`protocol` 记录模型、条件、时间分割、历史快照SHA-256、有效账本参数和交易日历，`modelVersions` 记录库版本。快照指纹不包含请求结束日之后的K线，但不是数据真实性认证。外部函数型开仓检查只标记 `externalEntryEligibility`，不能由JSON报告重建。

标签仍是**次日开盘到再次日开盘的未扣费价格收益**，不是胜率，也不是可实现成交收益。停牌、涨跌停、容量和成本造成的成交偏差由账本体现；没有把理论标签伪装成可成交标签。原有 `day + 2 < splitDay` 标签隔离和训练集标准化保持不变。

## 开源方案比较与本轮选择

| 方案 | 在本项目中的位置 | 本轮决定及限制 |
| --- | --- | --- |
| Ridge + StandardScaler | 原有线性对照；缩放仅在训练集拟合 | 保留；简单、便于发现复杂模型是否只有训练拟合优势 |
| ExtraTrees | 原有非线性树集成对照 | 保留固定参数及随机种子，避免改变旧实验基线 |
| HistGradientBoosting | 原有直方图梯度提升对照 | 保留；不使用随机早停切分 |
| LightGBM 4.6.0 | 新增可选CPU回归对照，同8项特征、同标签、同账本 | 首个新增候选，固定单线程参数；尚无真实独立样本证明优于旧模型 |
| XGBoost 3.1.3 | 新增可选CPU回归挑战者 | 本轮使用连续收益回归，不能直接把含负数的收益标签送入相关性分级排序目标；输出不是概率 |
| Qlib / Alpha158 | 量化实验框架 / 因子集 | 借鉴数据、实验、成本和组合验证流程；不是已训练的股票预测模型。引入Alpha158需单独做特征消融，不能与模型替换同时归因 |
| CatBoost | 可考虑可靠行业/板块类别特征 | 当前8项都是数值特征，暂不增加第三套外部依赖；时间顺序参数不能替代时序隔离 |
| MASTER | 股票关联与市场状态Transformer研究候选 | 暂不接入；官方仓库注明Qlib实现的数据处理差异，应先复现处理和外部留出验证，不能搬用论文收益 |

所有新增模型都只接受显式请求；默认仍为原三模型。可选库延迟导入，缺依赖时明确报错，不静默换成其他算法。五模型均固定CPU、单线程、随机种子42，不用测试集选参数；LightGBM/XGBoost固定参数也没有获得“最佳”认证。

官方资料：

- [Qlib](https://github.com/microsoft/qlib)、[LightGBM/Alpha158实验配置](https://github.com/microsoft/qlib/blob/main/examples/benchmarks/LightGBM/workflow_config_lightgbm_Alpha158.yaml)
- [LightGBM参数和目标](https://lightgbm.readthedocs.io/en/stable/Parameters.html)
- [XGBoost排序目标、qid与分组](https://xgboost.readthedocs.io/en/stable/tutorials/learning_to_rank.html)
- [CatBoost时间顺序参数](https://catboost.ai/docs/en/references/training-parameters/common#has_time)
- [MASTER官方仓库及Qlib数据处理说明](https://github.com/SJTU-DMTai/MASTER)
- [sklearn防泄漏](https://scikit-learn.org/stable/common_pitfalls.html)、[TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)

## 使用

在项目根目录创建独立Python环境并安装可选依赖；不改变基础部署依赖：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r V6_BO/tools/requirements-models-optional.txt
V6_MODEL_PYTHON="$PWD/.venv/bin/python" node V6_BO/tools/research-runner.js models /绝对路径/历史输入.json > /绝对路径/模型比较.json
```

历史输入仍需 `stocks`、按交易日对齐的 `bars`、`splitDay` 和 `source`。在原输入中可增加：

```json
{
  "models": ["ridge", "extraTrees", "histBoost", "lightgbm", "xgboost"],
  "modelFilters": {
    "minAverageTurnover20": 5000000,
    "maxVolatility20": 0.04,
    "minVolumeRatio20": 0.5,
    "maxVolumeRatio20": 3
  },
  "minPriorTurnover": 5000000,
  "maxParticipationPct": 1
}
```

这些数值**只演示字段格式，不是推荐门槛**。成交额 `amount` 必须由数据提供方明确为人民币元；不以股数/手数乘价格猜成交额。20日成交额使用信号日及之前19个交易日，缺任一天即拒绝；波动率为小数收益的20日标准差，量比为当日量/之前20日均量。条件支持精确边界，阈值处允许通过。不要为了获得回测通过而补造缺失数据。

## 验证与未完成项

基线独立源码副本实际运行全量回归：1,169通过、0失败。新增测试覆盖非成员价格扰动不改变合格股票预测、开盘后披露不可借用、缺失成交额、条件边界/未来数据、原V6同条件、费用协议变化、可选库缺失显式失败、五模型端到端和确定性。

修改后执行：

```sh
npm run check
V6_MODEL_PYTHON="$PWD/.venv/bin/python" V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
```

实际结果（代码提交 `ca360dd`）：`npm run check` 通过；全量 **1,183通过、0失败、0跳过**，包含隔离HTTP/服务启动回归及五模型端到端比较。环境为Node 24.22.1、Python 3.12.14、sklearn 1.8.0、LightGBM 4.6.0、XGBoost 3.1.3。可选模型实际安装并执行，未用缺依赖跳过替代验证。

本轮没有提供真实A股、去幸存者偏差且含完整历史成分和公司行为的独立样本，所以不报告“哪个模型收益更高”，不自动把新筛选条件写入生产评分。合成输入测试只证明工程链路可运行。当前仍是单次时间留出实验，正式选型还需按交易日滚动、多市场环境/成本压力测试，并保留最后一段未参与选模型和选条件的数据；同一天不同股票不能被拆进不同折。sklearn的`gap`计样本行数，不能直接当作多股票面板的交易日间隔。

六联动结果日志的1/3/5/10日收盘毛收益，与这里的隔日开盘预测和扣费账本口径不同，不能混比。原始报价时点、通知送达及全市场覆盖等外部验收状态不因本次离线改进而改变。

恢复：本轮独立分支 `codex/model-conditions-comparison`；可检出上述基线SHA恢复整个源码版本。已部署环境若需回退，应还原对应源码/构建版本并保留独立私有运行状态；本轮没有改写私有账户或模型权重。
