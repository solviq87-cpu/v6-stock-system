# 2026-11-25 决策中心验收证据

这些回执来自隔离目录和测试上游，不代表生产数据、线上部署或私密飞书送达。

| 文件 | 证据 |
| --- | --- |
| decision-browser-report.json | 真实后台接口到电脑 /、手机 /m 的完整计划、五秒首屏、执行清单、三处联动、返回恢复、空池和晚到响应。 |
| intelligence-browser-report.json | 新图谱与真实研究报告的按需读取、面积比例、原时点、缺值、跨日切股、只读身份和零写入。 |
| existing-browser-report.json | 原页面业务回归：402、768、1366、1920 像素。此前 320、390 像素场景已执行，完整原浏览器检查由 CI 再运行。 |
| final-targeted-verification.json | 最终专项 98 项全部通过；语法检查 63 个原生前端模块。 |
| regression-evidence-summary.json | 完整回归首次运行、未完成文件补跑及失败组恢复的实际记录，明确不是一次连续全绿。 |
| full-regression-tail-files.json | 补跑的 33 个测试文件，463 项全部通过；与首段去重后共覆盖 4,725 个已报告用例。 |
| workbuddy-focus-regression.json | 旧 WorkBuddy 同页刷新丢失键盘焦点的双端确定性反证，以及三套浏览器检查 10/10 通过的修复回执。 |
| paper-gate-hashes.json | 原五个交易/持久化函数相对 PR #347 基线逐字节未变。 |
| before-source-verification.json | 基线完整源码 ZIP 的 3,642 个 Git 跟踪文件校验；不含生产私有数据或完整 Git 历史。 |
| local-log-checksums.json | 原始本地测试日志的字节数与 SHA-256。 |

## 备份与实际边界

改前 Git bundle 保存了基线的完整源码树；基线检出为浅历史，bundle 不应当作完整祖先提交备份。另按同一精确 SHA 构建并逐文件验证了完整源码 ZIP，源码树为 1471cff58d9830d0da8a20563e10fa9acb300432。两种文件都不含服务器私有卷，不能替代停写后的生产冷备。

本轮未改原数据门禁、主副角色、设备授权和账本规则，未向外部通道发消息。真实 hfq 多源样本、外市场原时点日历、私密通道凭据和生产网络延迟按实际缺项保留。新权重提案不冒充已完成原流程验证，三进四观察规则没有虚构 OOS 成绩。

最终仓库提交仍须通过原 CI。生产切换与回滚执行根目录 HANDOFF.md 的当前检查点。
