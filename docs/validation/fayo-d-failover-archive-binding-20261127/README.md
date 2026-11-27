# D组第二十六批：历史备用缓存与原始入库回执绑定（2026-11-27）

## 基线与范围
接续 #509 精确 HEAD 342fc8f3e508345faf1f3305817fd865b007c9b3（包含 #495 与第二十四/二十五批队列修复及57项测试）。仅独立分支修改 market-failover.js，新增六项专项；不修改原历史导入 #473/#475、市场存证模块、真实策略、账户、交易权限、CI保护、总管分支。总管组合时保留 #473/#475 的生产门禁与 #507 的旧HTTP测试夹具修正。

## 六项小任务
1. 跨实例重启：已有原始存证时，调用原 readMarketDataAsOf，核对最新可见入库回执的证券数据集身份、日期、哈希、只读标志、receivedAt 与 availableAt。缓存年龄增加原接收时间锚点，不以文件mtime或复核时刻替代。
2. 老回执超时：即使文件刚被touch或旧数据后来复核，超龄仍拒绝；独立备用源按原优先级选择，不拼接数据。
3. 缺失及损坏目录：显式配置evidenceRoot或本实例曾见到存证，目录缺失/非目录/符号链接均不能自动降级为旧式无存证缓存。首次启动发现默认存证目录不存在、且没有明确要求存证时，仍保留原旧缓存兼容路径。
4. 内容真实性：回执返回的完整数据投影须与实际持久化文件SHA-256（JSON序列化口径）匹配；拒绝原存证读取错误、缺少admitted回执、未来/倒序时点、非法哈希与矛盾权限。原dataVersion是原始字节摘要，不与规范化输出摘要混淆。
5. 本次成功必须绑定已写出的文件与原始admitted回执的ID、原字节版本及availableAt；错误主源尝试不得晋升为成功或同轮缓存，仍可选择健康备用。
6. 验证存证后复读实际投影并校验指纹，阻断核验过程中可观察到的文件替换；无存证的合法旧缓存仍标为legacy-file-time-only-unverified和stale。返回archiveEvidence供研究诊断，canTrade/verifiedLive仍false。

## 实际 Node 原生测试
Node.js v22.16.0，实际生产 market-failover.js 与原 governor、真实本地文件系统、SHA-256、符号链接、文件替换及此前子进程测试。六项新增测试的 importer/market-data-evidence 依赖为明示的边界夹具：夹具从真实磁盘读取受控回执与原始字节并校验SHA-256，故障为测试生成，不是原市场存证链或供应商实际故障。真实生产readMarketDataAsOf调用契约已核对，完整#475存证语义、历史账本与多个真实进程原子读写尚未实际组合运行。

- 同六项新增反例：修前0/6，修后6/6。
- 原57项及新增6项在同一node:test命令中实跑：63/63通过，0失败，0跳过，0取消（约0.64秒）。
- node --check 两份文件成功。
- 原生产文件 blob f98964c76de17d62d50e1f6853b0ca09d4bacdf4。
- 修改生产文件 blob f1ad7102f6d650728f7ca697c29de9800cfe6a53。
- 新增测试 blob e25afb0f7f764d465c1c986fa952b1825ac594fa。
- 本地git hash-object与GitHub读回一致，原57项测试文件均保留。

复跑命令：
`cd V6_BO && node --test tests/market-request-governor.test.js tests/phase4-market-queue-clock.test.js tests/fayo-d-failover-recovery-integrity.test.js tests/phase4-market-failover-recovery.test.js tests/fayo-d-governor-process-recovery.test.js tests/fayo-d-failover-archive-binding.test.js`

本地使用独立V6_MARKET_REQUEST_STATE_DIR，避免真实运行状态。前57项包括真实Node子进程，新增6项的跨重启指重建服务实例而非真实机器断电。未联网取数、未部署、未买服务、未合并。

## 剩余边界
默认存证目录在进程重启前被全部删除、又未配置evidenceRoot时，无法单凭旧文件区分真正遗留文件与被删除的历史存证；旧文件仍只读降级、不授予交易许可。建议生产配置明确存证根目录。复读文件不能证明跨进程原子事务，原始存证链并发及掉电恢复仍需独立真实组合验收。#473/#475原生完整导入与原始回执专项、#507/#509正式CI结果及新PR全量回归仍待。未以新六项直接累加原D01–D78分母：保留60/78部分整改、18/78待核对继续、0/78完整验收已确认；76.92%为保守整改覆盖率。原任务书完整定义仍未恢复。
