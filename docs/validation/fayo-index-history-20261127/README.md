# F03.6 · 已封存分钟基准跨重启恢复

本批沿原 PR #562，父提交 `cb3dfd8b7a86b27edb938e5bbea18d205c6ad9fa`。对应 F03.1/F03.6、G02 的研究证据及效率第 11/12/17/20 章，不新编号。本页为候选工程验证，未合 dev、未部署，不代表整个模块或全部场景验收完成。

## 问题、复用与实际消费者

原指数研究保存至多 21 个观测日在内存；新进程缺少历史基准，不能再比较同分钟窗口。本批直接复用 `src/core/research-workspace-store.js` 的私有目录、原子提交、哈希链及锁内权限重验；`index-window-history.js` 只是日分桶的编解码与校验，未新建采集器或存储引擎。

原 `session-index-feed` → `index-window-research.observe` → 收盘后的原研究日志 → 新进程恢复 → 原 1/5/15 分钟同窗计算 → 原 `/api/state` 编辑者投影 → 大盘 / 市场概览 / 行情来源与补采状态。电脑、手机共用此后台。原只读投影从供应商请求的隔离开关中移出；鉴权及交易时段条件保留，隔离启动不分派外部采集也可消费已计算的本地研究。

## 数据和恢复合同

- 日目录为 `V6_BO/data/index-window-research/YYYYMMDD/`，通过原日志引擎保存 `diagnostic`。仅在北京时间 15:00 后或后续日期封存结束日；午休及 14:59 均不封存。同一天固定请求 ID，重复调用不新增记录。失败按至少一分钟退避，不重复获取供应商数据。
- 目录 0700、记录 0600；版本 `index-window-day-v1`、算法 `same-minute-absolute-range-v1`、指数身份、分钟范围、原始/接收/归档时点、来源和输入字段独立校验。负面来源、重复身份、符号链接、坏哈希及未来记录不被洗白。损坏档案不自动修复或覆盖。
- 启动最多读取最近 22 个日目录，单个日记录最多 256 KiB，返回至多 21 日，每日最多 948 个点；较早历史保留。该范围的恢复不等于审计全部旧档案，也不表示每个交易分钟覆盖完整。仍须每个窗口有 20 个同源且连续可比的历史样本。
- 恢复后的历史比较项绑定原日记录 `archiveHash`，保留原 `quoteAt` / `receivedAt`；读取时间不替代来源时间。校验和证明所读内容一致，不证明数据授权或供应商事实已独立认证。
- 盘中未封存样本、旧报价、旧异常结论及旧连续状态不恢复。本交易日重新采样；不足的窗口保持无合格输出。时钟回退清空本次基准并停止本次实例的档案写入，重启后重新核验；原日志保留。
- 原主实例权限在提交前及原锁内重验。研究状态明确 `sourceVerified:false`、`canTrain:false`、`canTrade:false`、`canNotify:false`，不扩大生产、模型、推送或实盘权限，不改原 15 秒执行报价门禁及权威账本。

## 实际测试与范围

[校验回执](receipt.json)绑定实际源码及脚本 SHA256。首批 7 个新用例修前 1 通过、6 失败；扩展后的关联 58/58，最终原生全量 8129/8129，失败、取消、跳过均为 0。初版全量 8126/8126 后补充哈希血缘及只读消费，不将初版结果移作最终版；两版原始日志在交付包分别保存。

[原服务回执](native.json)使用原临时部署、原编辑者登录、原 `/api/state` 和客户端。三种输入为已恢复、无档案、损坏档案，HTTP 均成功且状态分别正确；查看者不取得此研究投影。隔离副本只注入合成历史和随后新增观测，未新增生产端点或伪造服务返回。原只读入口最初受隔离采集开关阻断的失败日志亦保留。

三个真实 Chromium CSS 视口 1366、390、320 共 9 次流程；[已恢复](restored-browser.json)、[空档案](empty-browser.json)、[损坏档案](corrupt-browser.json)均无脚本错误或横向溢出。以下为实际运行的软件页面，**输入为隔离合成观测，不是真实市场、手机真机或实盘收益**：

[电脑实拍](restored-1366.png) · [手机宽度实拍](restored-390.png)

内核禁止出站的 57/57 专项及[原日志副本读取回执](offline-recovery.json)通过，20 日参考恢复并对新合成输入生成 2 个窗口，原归档字节不变。内核组不包含需要回环连接的 HTTP 测试；真实鉴权服务另在上述隔离 HTTP 层验证，不能混称同一层级或大陆实网。

复现（在 V6_BO，输出目录应为新的空目录，已有 archive 回执拒绝覆盖）：

```sh
node --test tests/index-window-history.test.js tests/index-window-history-http.test.js tests/index-window-research.test.js tests/index-window-continuity.test.js tests/index-news-association.test.js tests/index-continuity-view.test.js tests/research-workspace-store.test.js
FAYO_STUDY_RECEIPTS=/tmp/fayo-index-new-evidence FAYO_INDEX_BROWSER=../docs/validation/fayo-index-history-20261127/browser.py node ../docs/validation/fayo-index-history-20261127/native.cjs
python tests/helpers/deny-network-connect.py node ../docs/validation/fayo-index-history-20261127/offline.cjs /tmp/fayo-index-new-evidence/archive
node ../docs/validation/fayo-index-history-20261127/performance.cjs
```

## 受控成本及限制

[本机单次成对探针](performance.json)对无日档与启用日档使用相同 18960 条合成观测、相同硬件和算法。20 日满量记录合计 2719020 字节；该次封存耗时 P95 约 13 ms（20 次样本），暖文件缓存读取约 72 ms（1 次）。原始耗时、CPU、内存及硬件写入回执。未据此推算用户机器、磁盘、最坏延迟、节省比例或投资增益；GPU 不参与。

真实 20 日采样、长期前向价值、供应商用途许可、Windows/WSL 及实体设备、大陆网络和正式备份计划覆盖仍待原总管现场核对。封存分钟缺口不会自动补价；若旧日目录的所选范围不足，继续积累或明确未知，不导入事后下载数据并伪造当时接收时间。

## 回退与正式启用

只回退本批源码/界面说明，保留新增日研究目录、已有账本与其他研究历史。不得以旧数据卷覆盖新流水。正式部署前将该私有目录纳入原持久化及受控备份/恢复流程，保持目录/文件权限和原日志哈希；本次副本读取不等于生产整卷恢复。总管审批、最终组合回归及当前精确提交 CI 分别记录，策略及实盘授权仍独立。
