# V6 第59批：统一工程 Python 三轮证据接入

## 修改内容
- `src/core/python-three-round-evidence.js`：增加三轮 Python 原生运行证据校验，校验股票、日期、截止时间、三轮顺序、判断依据、运行来源和版本。
- `src/core/native-strategy-daily-runner.js`：按 `symbol/date` 读取 Python 三轮证据，保留独立覆盖率和回放来源；缺失时标记 unknown。
- `src/core/unified-strategy-project.js`：统一入口传递 Python 证据。
- `scripts/unified-strategy-project.js`：可选第三个输入文件 python-evidence.json。
- `tests/python-three-round-evidence.test.js`：新增五项行为测试。

## 使用
`node scripts/unified-strategy-project.js history.json snapshots.json python-evidence.json`

Python 证据输入示例：
```json
{
 "000001/2025-03-04": {
  "symbol":"000001", "date":"2025-03-04", "observedThrough":"2025-03-04",
  "evaluatorVersion":"python-native/v1", "provenance":"python-runtime:run-20250304",
  "rounds":[
   {"round":1,"verdict":"pass","observedThrough":"2025-03-04","reason":"由真实评估器生成的理由"},
   {"round":2,"verdict":"pass","observedThrough":"2025-03-04","reason":"由真实评估器生成的理由"},
   {"round":3,"verdict":"pass","observedThrough":"2025-03-04","reason":"由真实评估器生成的理由"}
  ]
 }
}
```
上述仅为输入格式示例，**不是历史真实运行证据**。

## 验收
全量自动化测试 309/309 通过；没有执行真实 Python 策略、没有联网验证 A 股行情，也没有完成真机验收。

## 后续阻断项
1. 找到并接入用户认可的 Python 三轮原始策略程序；当前工程未发现三轮原生执行器，不能编造规则。
2. 验证历史数据来源、复权和公司行为，开展真实样本外回测。
3. 对模拟盘连续运行、双端操作及部署开展完整验收。
