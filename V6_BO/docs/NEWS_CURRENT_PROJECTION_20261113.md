# 新闻当前分类与缓存失效修复

基线 `7ef3d560bdcc3a1b02fe17eae6f07ccc4a37ae26`，分支 `fix/news-current-projection-20261113`。不新增供应商请求或外发任务，不改原始 journal 格式、内容或已有信号文件。

同一 ID 从利好改为利空时，原来按 ID 只新增的三个分类档案会同时留下旧利好和新利空。现在分类行保存经真实供应商适配器内容版本比对后的 `newsEvidence={eventHash,sourceRevisionId,sequence,recordedAt}`；正文标题、90 字摘要、股票关联及原发布时间也须与 journal 当前版本一致。同 ID 同类更新替换旧投影，跨类更新从旧类别移除，撤稿不能被后来重放的旧原文复活。全部历史版本仍由原追加 journal 保留。旧 `news.json` 未绑定 journal 的条目保持未知，不再作为确认利好或确认利空；后续成功采集可重新建立同版投影。

`newsSupportsCode/newsWarnsCode/newsWarnsSector` 只检查匹配股票或板块的条目，不为每个候选构建整份可见状态。预选盘 `analyzePreBuy`、tick 的门槛和风险、洗盘 `judgeOne`、持仓/候选风险标记及 tick 冻结时的 goodHit/badHit 均走同版判断。真实 CLI 追加撤稿后，无须供应商刷新即可停止引用旧利空；旧集合即使还留着股票代码，也不能继续影响这些决策。

缓存使用目录设备/inode/权限/纳秒修改及更改时间戳；目录发生变化立即重验完整链。每次实际引用的当前版本记录都检查设备/inode/大小/权限/mtime/ctime/链接数，变化立即重验或转为 unknown。其他未引用记录的元数据最多隔 1 秒复核一次；这是明确的全链损坏发现窗口，不宣称同秒每次判断都重新验过所有旧文件。完整 JSON、哈希链仅在清单或元数据变化时重读，沿用 10000 份、单份 128KiB、总量 128MiB 的 journal 上限。缓存内部保留 `chainVerifiedAt` 与 `metadataCheckedAt`，不把最近元数据检查冒充最近完整链验证。

引用记录被原地修改不会改变目录 mtime，修复前热缓存会漏检；修复后当前引用立即失效，未引用版本在 1 秒窗口内失效。读取、权限、锁、损坏或采集归档失败均不继续沿用旧 positive；原文件不会被修复器覆写。拥有完整写权限者整套重建链、删除整个末尾或回拨系统时钟仍不在本地哈希的认证能力内，需独立备份末端 hash。

专项命令及实际结果：

```sh
node --check server.js
node --test tests/news-current-projection.test.js tests/news-evidence-journal.test.js tests/integration-observer-news.test.js tests/production-signal-evidence.test.js tests/funds-monitor-continuity.test.js tests/news-china-cloud-timezone.test.js tests/news-evidence-http.test.js
node _test_holiday_news.js
node _test_news_daily.js
```

语法通过，专项 55/55，通过真实隔离 HTTP 启动、CLI 写入、停服重启重读及原有权限门禁；旧假期 32/32、日报 20/20。新增 9 项覆盖实际 refresh 的原始利好→修订利空→撤稿→重放旧版、同类/关联股/中性修订、当前引用坏档/权限立即失效、未引用坏档 1 秒发现、未绑定缓存及失败采集、分类内容与版本一致、真实 CLI 追加撤稿后实际 `analyzePreBuy` 决策变化，以及性能边界。没有调用真实供应商或发送消息。

日志在 `/workspace/next-output/news-projection-targeted.tap`、`news-projection-holiday.log`、`news-projection-daily.log`。两个热缓存性能例分别使用 100/1000 份真实 journal 文件，6000 次实际 `newsSupportsCode` 为 96.32/70.87ms；都没有重复读取完整链或遍历全库元数据，各有 18000 次定长元数据检查。该数值是当前环境离线结果，不代表线上延迟承诺。

`node _test_wash_trend.js` 因缺少未跟踪的 `_publish.py` 无法启动；精确基线同命令也以相同 ENOENT 失败，分别保留 `news-projection-wash.log` 与 `news-projection-wash-baseline.log`。静态接线断言已更新为当前同版 helper；未为该原有工具缺件改动发布流程。按主集成安排未重复全量回归。

回滚：revert 本分支提交，保留私有 journal 及既有信号归档，不能清空新闻链或从旧 ZIP 覆盖代码。两张锁定主页未改。
