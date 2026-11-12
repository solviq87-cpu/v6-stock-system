# PR #174 正确性复核（2026-11-12）

验证输入：head `54e4ed7831c5cf4166971e788483c035b44d2794`；修改前 PR 基线 `ad76f74a57dcef210cde2b25912f817d6462154a`。不合并、不部署、不真实外发。未覆盖任何历史 ZIP，未修改主页或视觉样式。

## CI 缺口

原 head 的 Actions API 返回 total_count=0。PR base 是 feat/tian-shu-ui-linkage-20261112，原 V6 CI 只接收目标 main/dev 的 PR。增加 feat/** 目标触发，保留 verify / verify-web 原有测试。分支保护接口 403，不能证明 GitHub 已强制这些检查。新提交的远端运行结果应独立查询，不能用本地结果冒充。

## 11 项 ML/Python 失败的基线对照

使用两份独立 worktree，同一 Node 22.23.5 和相同解释器配置，test-concurrency=2。

| 配置 | 修改前基线 | 原 head |
| --- | --- | --- |
| 未配置 ML Python，脚本实际选 /usr/bin/python3 (3.13) | 1916 tests / 1901 pass / 12 fail / 3 skip | 1920 tests / 1906 pass / 11 fail / 3 skip |
| V6_MODEL_PYTHON=同一隔离 Python 3.11.18，仓库固定 ML 依赖，三个 ML 测试文件 | 19 pass / 0 fail / 0 skip | 19 pass / 0 fail / 0 skip |

共同的 11 项失败：model-research 的 CLI 与两项因果性测试（3）；model-selection-conditions 的历史资格、开盘披露、成交额、原策略同条件对照（4）；optional-model-baselines 的默认模型、非法数值、lightgbm/xgboost 缺依赖处理（4）。都在基础 sklearn 导入处失败，stderr 为安装 requirements-models.txt 的提示。输入校验与可选依赖检查尚未执行，因此出现后续错误文案不匹配。基线额外失败为 stock-provider-links 的历史切股测试，属于本 PR 已修复问题。

固定依赖：scikit-learn 1.8.0、lightgbm 4.6.0、xgboost 3.1.3；本次解析的 numpy 2.4.6、scipy 1.17.1、joblib 1.6.0、threadpoolctl 3.8.0。设置 OMP_NUM_THREADS / OPENBLAS_NUM_THREADS / MKL_NUM_THREADS=1。未改 ML 实现、断言或跳过条件；安装所有可选依赖后，三个原有跳过也实际运行成功。

最初默认 Node 24 沙箱探测产生文件级失败及本地 HTTP 隔离问题；该结果不充当功能验收。上述对照和最终验证均使用 Node 22，在允许本地 HTTP 的同一环境执行。

## 最小正确性修复

- 盘中批次仅为实际进入消息的 top 信号保存 code/type/ts 标识；页面按完整标识、触发时间和非未来回执关联。旧日志和同票其他策略/消息只保留历史，不能证明当前信号送达。不更改通道、额度、去重或外发策略。
- 未知送达显示待确认，不当作成功；去重闭锁原有行为保留，避免超时后重发。
- 发送失败与市场信号有效期分开；老信号即使仍有候选行情也不会一直显示有效。缺失/未来触发时间维持未知。
- 行情价格、涨跌幅、量价资金和原始时点取自同一行；不借用 state.stocksAt 或触发时间补原始报价时间。
- 同票不同策略保留历史，重复次数按同策略额外触发统计。
- 原 dashboard-view 测试仅补充真实回执标识 fixture，全部原断言保留。新增 11 项边界/发送隔离测试；其中首批 8 项在修复前全部失败。

## 实测结果

| 检查 | 实际结果 |
| --- | --- |
| V6_BO npm test（最终源码） | 1931 pass / 0 fail / 0 skip，TAP 完整性检查成功 |
| npm run check | 成功 |
| 推送专项（包含于全量） | 17 pass，其中新边界测试 11 项 |
| V6_WEB npm ci / build / test / dist 一致性 | 40 pass / 0 fail，dist 无差异 |
| 根目录 archive unittest | 20 pass |
| 八项联动专项（包含于全量） | 30 pass |
| yellow-four 专项（包含于全量） | 18 pass |
| 行情源目录 audit / 发布结构 preflight | 成功；preflight 生产证据警告保留 |
| 完整服务隔离 HTTP 启动冒烟 | 成功；含首页、选股/竞价/参考页、脚本、404 和无凭据拒绝 |
| Chromium 布局与交互 harness | 9/9 视口，1366/1536/1920、1024、320/375/390/393/430 |

全量覆盖现有策略、指数/情绪/板块、因子/研究、模拟成交、账户账本、风险与权限测试。浏览器 harness 使用明确标注的本地合成数据，未启动交易服务，不能作为实盘或真实账户验收。

复现最终回归：

```sh
# Node 22 位于 PATH；ML_PY 指向已安装 tools/requirements-models-optional.txt 的 Python 3.11
cd V6_BO
V6_MODEL_PYTHON="$ML_PY" V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node --test tests/dashboard-view.test.js tests/dashboard-push-correctness.test.js
npm run check
node tests/full-server-isolated-smoke.js
V6_UI_BROWSER=/usr/bin/chromium node scripts/ui-reference-browser-check.js
```

本地完整日志位于 /workspace/evidence-174（未入库；无生产凭据/账户数据）。

## 尚未验证或仍有限制

- 远端最终 SHA 的 CI 结果与 GitHub 强制检查设置须另外核实。
- 真实盘中多源行情长期稳定性、真机 Safari/微信、生产账户与真实消息送达未验收。
- 历史日志无信号标识时只能显示历史，不能反推精确策略归属；只剩历史日志且已不在候选/信号中的股票不会新建当前信号卡。
- 历史条数仍受服务端 240 条、投影每票 20 条等已有展示窗口限制，不代表全部耐久档案。策略版本字段仍来自应用/状态元信息，不能证明历史信号的冻结策略版本。
- 指数范围当前按代码市场分组，不能当作成分股精确归属；展示的条件满足度不能替代正式策略条件的完整重放。
- 未改参数、正式策略、账户协议或视觉设计。回滚应 revert 本次提交，禁止覆盖旧包。
