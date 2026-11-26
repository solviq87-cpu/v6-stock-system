# 第 67—78 项验证记录

本记录只陈述已执行验证。隔离 fixture、浏览器测试、历史回放均不计真实运行日，不证明生产已部署、策略收益或数据授权。

- 基线：`dev@b9b44474be7fd27732e37d868ed64dbfddd3e8e9`。
- 分支：`feat/fayo-depth-decision-20261126`。
- 环境：Node 24.22.3；原轻量 Python 与可选模型 Python 分开；测试并发 2。
- 基线全量首次执行有 18 个环境失败：14 个模型解释器缺依赖、4 个临时目录祖先符号链接。没有降低代码门禁；固定 `V6_MODEL_PYTHON` 指向已有模型环境，并将 `RUNNER_TEMP` 设为真实的私有临时目录后，受影响测试补跑通过。

## 复现命令

```sh
npm run check
RUNNER_TEMP=/absolute/private/real-directory V6_MODEL_PYTHON=/absolute/model/python \
  V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node --test V6_BO/tests/deep-research-evidence.test.js V6_BO/tests/deep-decision-research.test.js \
  V6_BO/tests/deep-research-workspace.test.js V6_BO/tests/deep-research-http.test.js \
  V6_BO/tests/release-provenance.test.js V6_BO/tests/runtime-acceptance.test.js
python3 -m unittest tests/test_windows_host_bundle.py
# 从 V6_BO 目录执行，Playwright 和实际 Chromium 路径由测试环境提供：
node scripts/fayo-deep-research-browser-check.js
```

## 本轮证据

整合预验收全量 `npm test` 已完成：5086项，5082通过、0失败/取消、4项可选环境跳过；TAP唯一结束计划与完整性验证通过。跳过项为真实PowerShell包装器、需要完整可选模型环境的五类模型对照、LightGBM及XGBoost。最后运行采样门禁及原参与率适配会另作专项及精确提交验证。已完成的专项包含真实 server→handler→worker→原私有研究日志、角色/设备/主副/撤权、原账本字节不变、请求重试/内容冲突、事前信息与15秒门禁、原始成本/订单冻结、构建产物实际校验与损坏拒绝、真实日计数排除测试。

主要测试文件与任务映射见 `docs/FAYO_DEEP_RESEARCH_20261126.md`。测试以真实执行命令退出状态和最后 TAP 计数为准；不将子分支过去的绿灯当成合并版本证据。


| 已执行验证 | 结果 |
| --- | --- |
| `npm run check` | 服务语法及69个原生模块通过 |
| 新增六类专项（最后运行门禁修正前） | 90通过、0失败/跳过 |
| 完整仓库整合预验收 | 5082通过、0失败、4可选跳过，5086完整报告 |
| 原生完整界面浏览器 | 8个场景、6种视口通过 |
| 新增研究界面浏览器 | 1536×1000与390×844通过，原私有操作实跑，撤权和viewer零私有读取通过 |
| Windows打包Python专项 | 16通过，包括构建ZIP→提取→Node校验、篡改拒绝、运行绑定错配拒绝 |
| 发布版本/原恢复页一致性 | 3通过，旧恢复页字节锁保留 |

双端详细结果见 [浏览器报告](browser/deep-research-browser-report.json)；原专项记录见 [交付验证](targeted-delivery.txt)；跨组只读路径重合审查见 [接口集成审查](integration-review.json)。本组没有合并其他五个草稿PR，未将这些检查称为六组最终集成验证。


最后独立复核修复：价格缺失/0/NaN不能计真实新鲜行情；研究日历不获得运行资格；每条采样保留最多10条原时间/来源/判断及有界全批摘要。运行/来源/workspace组合33项通过，最后摘要修订后的runtime16项再次通过。原成交参与率只读桥和真实HTTP/账户专项21项通过；研究比例只能更严，原交易执行函数未变。

最终代码固定后将由同一PR的精确head CI执行完整回归；相关回执通过PR检查项查验，不以本文预验收替代。

最后六类专项整体重跑：**96通过、0失败/取消/跳过**，包括全部最后修正。原始TAP见 [targeted.tap](targeted.tap)。`npm run check` 再次通过69个原生模块。
