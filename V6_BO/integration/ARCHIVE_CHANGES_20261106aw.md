# 工程修改与Bug记录

新增 src/core/adaptive-monitor-archive.js、scripts/adaptive-monitor-archive.js、tests/adaptive-monitor-archive.test.js。package.json增加research:history入口；server.js和public的app/index/mobile/sw仅同步aw缓存版本，未改布局。新增操作、测试与交接文档；所有旧文件保留。

修复：普通目录rename可能覆盖并发创建的空目标，采用Linux不覆盖原子发布；输入在复制期间变化则拒绝发布；归档与监视使用同一内核锁；中断不发布残缺快照；恢复不重置容量/修订。新增测试首次有1条断言过窄（合法提前拒绝错误信息不同），已修正断言并保留资金/索引不变及目标未发布检查。首次定向日志保留供审查，非生产故障。

本轮没有已知未修复的归档测试失败；不等于不存在潜在Bug。未完成生产/跨机/真机等验收见交接。1000条与128MiB边界使用明确标识的合成存储夹具，不表示真实策略收益。
