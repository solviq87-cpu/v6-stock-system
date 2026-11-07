# 完整监视历史离线归档恢复（20261106aw）

本版新增字节保真离线归档，不复算旧报告。应用 aw，原监视存储协议仍 as。原四套策略、主账户和双端布局未改。最多1000条、报告合计128MiB，单报告16MiB；达到上限仍拒绝新增，不自动清空、轮转或重置编号。

## 操作

需要 Node22.6+、Python3、Linux flock 和支持 renameat2(RENAME_NOREPLACE) 的系统/文件系统；不支持时拒绝发布。V6_NATIVE_PYTHON 可指定原生 Python。ML解释器另按部署机器配置 V6_MODEL_PYTHON。

```bash
node scripts/adaptive-monitor-archive.js archive /safe/monitor /safe/new-archive --expected-revision 10 --input /safe/latest-input.json
node scripts/adaptive-monitor-archive.js verify /safe/new-archive
node scripts/adaptive-monitor-archive.js restore /safe/new-archive /safe/new-restored --expected-fingerprint 从归档返回的64位指纹
```

先停止写入或等待正在运行的监视任务结束。archive 使用原 monitor.guard 内核锁；修订必须与当前历史条数一致。--input 可省略，提供时只保存与最后报告匹配的最新输入，不能恢复缺失的历史原始输入。目标必须是新目录，来源与目标不能重叠。可将归档目录整体离线复制，再以事先保存的指纹核验/恢复。

归档保留原 manifest.json 和所有报告的原始字节，外层 archive.json 记录文件清单、大小和SHA。未知、残缺、篡改、符号链接及未提交内容拒绝；不删除坏数据来通过。完整暂存与文件/目录同步后，原子发布且不覆盖抢先创建的空目录。进程中断后保留未发布暂存，人工保留调查后用新任务重试；发布后中断可直接 verify。restore 对完全相同的已恢复目录允许幂等返回，其他已有目标拒绝覆盖。

恢复后监视器的 outputRoot 是 /safe/new-restored/monitor；可选原输入在 /safe/new-restored/input.json。开始继续监视后，子目录出现锁或新记录，外层归档快照不再代表当前运行目录；使用原监视 verify 检查运行历史，并另归档到新位置。达到1000条/128MiB的恢复历史仍保持上限，不能借恢复突破限制。

归档核验是存储完整性验证，replayed=false、canTrade=false，不认证供应商或真实收益，不是确定性旧算法复算。需复算旧au/av导出时，保留对应原工程及输入，不能改指纹。SHA不是签名，不能防有权限者重写整套证据。SIGKILL不是物理断电；跨机灾备和长期生产仍待现场验收。
