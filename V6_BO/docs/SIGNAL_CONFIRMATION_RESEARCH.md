# 公开策略的相互确认信号

本批在现有公开战法历史回放中增加两条研究入场信号。来源用于核对规则，计算按 V6 的日线数据约定独立编写。阈值是预先指定的研究参数，尚无样本外净收益结论。

| 信号 | 同时满足的条件 | 规则来源 |
| --- | --- | --- |
| 均线交叉＋Aroon | 15日均线上穿30日均线，且 Aroon25 振荡值大于零 | [QuantConnect LEAN 均线样例](https://github.com/QuantConnect/Lean/blob/master/Algorithm.CSharp/MovingAverageCrossAlgorithm.cs)（[Apache-2.0](https://github.com/QuantConnect/Lean/blob/master/LICENSE)）、[ChartSchool Aroon](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/aroon-oscillator) |
| MACD＋均线趋势 | MACD(12,26,9) 上穿信号线，收盘高于30日均线且均线上行 | [ChartSchool MACD](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/macd-moving-average-convergence-divergence-oscillator) |

两条规则共用趋势确认家族。统计按股票和信号日去重，同家族共振记作重叠。信号使用已收盘的日线，沿用现有次日开盘、T+1、交易成本、涨跌停及公司行为门禁。默认持有观察窗口为1、5、20、60个交易日。

## 本地研究与 CI

在现有研究台导入包含 `history` 的 JSON 请求。以下是与原有输入合并的字段。命中与同日重叠记录出现在 `publicRuleForwardAudit`。

```json
{
  "validatePublicRules": true,
  "publicRuleAuditOptions": {
    "includeSignalConfirmation": true,
    "includeLinkedRules": true,
    "includeQualityRules": true
  }
}
```

本地 Node.js 22 环境安装完成后，从仓库根目录运行专项。现有 V6 CI 的全量回归会自动发现该测试文件。

```sh
node --test V6_BO/tests/signal-confirmation-research.test.js
```
