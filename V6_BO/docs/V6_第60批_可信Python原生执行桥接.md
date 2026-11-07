# V6 第60批：可信 Python 原生执行桥接

## 主要改动
- `src/core/python-native-bridge.js`：仅对操作者明确指定的可信 Python 策略脚本执行逐日、逐股票、截至当日的历史行情前缀；限制运行时间和输出体积；不使用 shell；不传入未来行情。
- `scripts/python-native-evidence.js`：生成可由第59批证据校验器导入的三轮信号 JSON。
- `scripts/unified-strategy-project.js`：支持 `--python-native-script /absolute/path/trusted.py`，与外部证据文件互斥。
- `tests/python-native-bridge.test.js`：原生进程运行、观察日期、JSON、退出异常和显式路径测试。

## 使用方法
可信脚本需从 stdin 读取 JSON `{schemaVersion,symbol,date,observedThrough,source,bars}`，向 stdout **只输出一个 JSON**，结构必须符合 `python-three-round-evidence.js` 的 `symbol/date/observedThrough/evaluatorVersion/provenance/rounds` 要求。

```
node scripts/python-native-evidence.js history.json /absolute/path/trusted.py > python-result.json
node scripts/unified-strategy-project.js history.json snapshots.json --python-native-script /absolute/path/trusted.py
```

## 重要边界
- **原始 Python 三轮策略规则仍未找到**，本批没有编造策略或替代策略，桥接只执行由操作者审计并提供的原生程序。
- 只允许运行可信本地代码；Python 进程不构成沙箱，不能执行网络来源的不可信脚本。
- 每日每股票启动一次 Python 进程，适合离线验证；大规模股票池需后续批处理优化。
- 真实行情、样本外收益、真机和实盘验收仍未完成。
