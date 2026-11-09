# V6 新增研究战法：趋势质量、量价累积与低位恢复（2026-11-09）

## 研究来源、许可边界
- Qlib Alpha158 中的滚动回归趋势、斜率、R²和量价相关性研究思路：https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/loader.py
- Backtrader 内置 OBV、随机指标、趋势指标等公开研究概念：https://backtrader.readthedocs.io/en/latest/user-guide/indicators/indicators.html

本模块是 **V6 独立编写的日线研究假设**，没有复制来源项目代码、原策略参数、回测收益或交易执行流程。没有任何真实收益/资金流认证。全部需要不少于45根日期连续排序的有效日K线，禁止将当日未完结日线当最终信号。

## 三套可计算战法
1. `linear_trend_quality20`：过去20根对数收盘价按交易日编号做线性回归，R²≥0.70、每交易日斜率≥0.15%、收盘高于此前20日均线、近20日上涨家数（逐日收涨占比）≥60%。**趋势质量是形态指标，不证明持续上涨。**
2. `obv_volume_accumulation20`：近20日收盘相对前一天的涨跌方向乘当日成交量，求净和并除以20日总成交量，净比例≥20%、最近5日方向成交量合计为正、20日涨幅介于-5%与12%、现价高于此前20日均线。**方向成交量不等于资金净流入或机构主力行为**。
3. `rsv14_reversal_confirmation`：前一日RSV14≤30，当日RSV14上穿45，收盘高于前日收盘，且当日成交量至少为此前20日均量1.1倍。低位反弹也有假反转风险，并不代表确定底部。

## 六项独立研究因子
- `quality_r2_20`：对数收盘价20日回归解释力R²
- `quality_slope20`：对数收盘回归对应的单日百分比斜率
- `signed_volume20`：20日涨跌方向成交量占比；**不是资金流入量**
- `price_volume_corr20`：日收益和对数成交量的Pearson相关系数；缺价格波动或量变化则为 `unknown`
- `rsv14`：最近14日收盘相对最高/最低价区间位置
- `upday20`：最近20日收盘上涨比例

三套规则划分为不同研究族（趋势质量、量价累积、反转确认），与已有 **突破-成交量研究族**分开记录。出现共同命中仅提升研究观察优先级；未经样本外验证不得修改正式权重、交易资格或原四套评分，不能因为市场急跌而直接认定某个因子失效。失真、缺数据、ST、停牌、无涨跌幅限制或零成交一律不给新增研究信号。

## 实际接入点及待办
- `src/strategy/quality-volume-reversal-research.js`：只读逐股纯计算；每条规则返回每项条件通过/未通过和实际指标值，数据不足为 `insufficient_data`。
- `src/core/research-explanation-projection.js`：加入 `qualityResearchCatalog`、每股 `rationale.qualityResearch` 和 `qualityFactors`，仅将真的命中规则列入策略入口及对应股票研究观察池。
- `public/assets/complete-workbench.js`：股票详情列出新因子来源状态，区分“入选条件”和“已观察到上涨但上涨原因未核实”。
- `tests/quality-volume-reversal-research.test.js`：覆盖上涨趋势、量价累积、RSV恢复、止损/风险隔离、时序与模拟研究边界。

**还未完成**：三条规则的独立成本化1/5/20/60日验证、原始市场数据和公司行为的外部对账、统计稳健性比较、国内线上部署和参考界面1:1视觉验收。已有PR #15的历史前瞻审计入口目前主要覆盖之前5套规则；本批不虚报已经加入验证。建议下一批扩展审计的独立规则白名单后，再评估是否允许晋级研究候选。
