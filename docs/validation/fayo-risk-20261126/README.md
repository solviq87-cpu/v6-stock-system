# FAYO 风险中心组验证 · 2026-11-26

## 基线和范围

开工/最新复核 `dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`；工作分支 `feat/fayo-risk-center-20261126`。覆盖01/02/03/04/05/14/30；接口与逐项映射见 [合同](../../FAYO_RISK_INTEGRATION_CONTRACT_20261126.md)。本页只记录本次实际运行，精确最终提交及CI结果将在完成后更新；不得引用前轮4996项或其他组CI作为本组结果。

## 已执行与待完成

| 验证 | 当前实际证据 |
| --- | --- |
| 权益、压力、风险聚合、双账户故障恢复 | 40通过，0失败，0跳过；临时权威账本、通知关闭，原账本文本不变 |
| 真实完整服务器隔离HTTP | 8通过，0失败，0跳过；含GET/POST在途设备撤权、只读、副本、账户复位epoch、未成交敞口、通知状态CAS |
| 完整服务器隔离启动 | `node V6_BO/tests/full-server-isolated-smoke.js` 通过；阻断外网、临时私有目录 |
| 通知原链及去重 | 专项已运行，最终合跑结果待更新 |
| 旧UI/缓存契约 | 20通过；只改预期参考权益、统一风险GET与版本，旧恢复页字节断言保留 |
| 原完整 `npm test` 第一轮 | 5089总项，5074通过、11失败、4可选跳过；失败已定位，修复后必须完整重跑，不能视为通过 |
| 本地浏览器 | 未执行成功：本地Chromium二进制缺失，官方安装下载被网络403拒绝；云浏览器无法访问本地隔离端口。未绕过网络/浏览器策略 |
| 电脑/手机真实浏览器 | 已新增 `scripts/fayo-risk-browser-check.js` 并接入原UI workflow，等待GitHub隔离运行器实际执行及结果核验 |
| 最终提交CI | 待工作分支/PR提交后逐项核验；不能以本地专项代替 |

第一轮11个失败中，4个来自旧通知factory VM夹具未注入新runtime，3个来自原首页/版本断言需按保留全部功能的新显示同步。另4个为基线已存在的测试环境问题：`/var/tmp -> /tmp`，生产验证器正确拒绝符号链接祖先。以基线文件在临时副本复现相同4失败，再用 `RUNNER_TEMP=/tmp` 对照13/13通过；仅将测试fixture父目录 `realpathSync`，生产权限/哈希/符号链接拒绝保持，默认及规范路径各13/13通过。

## 可复现命令

```bash
npm run context:resume
npm run check
V6_MODEL_PYTHON=/path/to/python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node V6_BO/tests/full-server-isolated-smoke.js
# 在安装原工作流Playwright驱动和Chromium的隔离环境：
NODE_PATH=/path/to/playwright/node_modules V6_UI_BROWSER=/path/to/chrome node V6_BO/scripts/fayo-risk-browser-check.js
```

原全量脚本必须完成TAP完整性校验；新`tests/*.test.js`自动纳入，未删除/跳过原用例。双端脚本从原账户服务创建隔离持仓及未成交买单，读取真实统一runtime和派生文件；网络拦截禁止站外请求，末尾断言原权威账户字节不变、无交易写入/真实外发。截图/原始日志不提交Git。

## 未测和真实性边界

未取得生产程序/私有卷，未进行生产冷备、部署、真实行情时延、真实私密网关和接收端确认。当前原权威账户没有独立外部出入金事件接口，无法解释的现金差异使收益计算未知；原reset/初始资金改变独立epoch。常规一分钟权益采样可计算观察区间回撤，无法证明采样间极值或连续全账户历史最大回撤。固定压力是假设、未作真实概率校准；题材重叠不是统计相关系数。策略衰减、模型校准等依赖策略组，缺回执保持未知。

## 恢复

改前源码bundle完整性已验证，SHA-256 `9ff7ccc75186fbd27ebe660ad6bd4fdf07e956b0106c0e0936f0aff310a1a232`。本地检查点 `checkpoint/fayo-risk-base-20261126` 与GitHub基线提交可复原源码，不代表生产冷备。按HANDOFF停写/保全新流水/切回完整旧程序与原卷；保留新 `risk-evidence` 派生档，不重放通知，不用旧账户文件覆盖新增成交。
