# 本机启动健康检查与真实进程恢复

起点：`dev@9251e27d718e52ca2568f17b1c360ecae8a69102`，含 #213/#214/#215。
工作分支：`fix/local-host-health-restart-20261114`；V6-005/006，沿用现有 Windows/WSL 本机启动器，不创建另一套部署系统。
最终 PR 与 CI 回执以该分支对应的 GitHub PR 为准；本文件记录可复现的实现和本地证据，不静态猜测“已合并/待合并”。

## 复现与修复

- 原健康探测只设置 socket 空闲超时。接口每25毫秒写一个空格而不结束时，`check` 和 `start` 可一直等待，控制器持有的锁也无法正常释放。新增独立总时限，最多1秒，完成时清理计时器和请求。
- 服务器发送半段JSON再断开时，原探测没有处理响应的 aborted/error/close；控制器可能在Promise未完成时退出而没有JSON结果。三类响应结束事件都明确结算失败，后续状态查询和停止仍可用。
- 每次启动探测使用剩余等待预算，整体探测循环使用单调时钟。250毫秒启动预算不再被一个持续输出的响应无限延长。
- 本地快照恢复从“启动采集器”移到共同启动阶段。正常生产仍在启动采集前恢复；隔离 Smoke 也恢复本地文件，仍跳过外部采集、推送和定时任务，不新增网络请求或写接口。

失败后保留进程记录和账户数据，不擅自杀其他进程、不自动重置目录。既有PID/启动时间/boot ID/路径/权限校验仍保留。`running` 和 `health=true` 含义不同。

## 行为验证

新增3个独立控制器进程用例：慢速响应、响应中断、启动总时限；增强既有真实完整后台测试。修复前本文件22项中18通过/4失败，均有实际TCP或HTTP行为，无外部服务请求。

完整后台验收使用临时合成账户和100只合成历史报价：初始化→启动→设置密码→两路独立HTTP读取→停止→重启→确认密码仍在→重新登录→两路读取。逐项确认：

- `stocksAt`、逐票原报价证据和板块日期不因重启变新。
- 退市股仍剔除，正常股保留，两路客户端读回一致。
- 三份原始快照文件逐字节不变；密码文件在重启后、再次登录前逐字节不变，登录后密码哈希未变；模拟盘文件未变。
- 再次登录依法新增本机设备记录，所以文件持久化断言放在登录前；没有为了通过测试修改账户逻辑。
- smoke违规日志为空，进程和临时目录由测试清理；没有读取真实用户账户或发送消息。

本轮关联38项全部通过；Windows部署包构建/私有文件排除/固定源码校验12项通过。语法和隔离完整服务HTTP冒烟通过。最终全量3400项：3397通过、0失败、0取消、3项可选LightGBM/XGBoost依赖缺失跳过；TAP完整性通过、退出0。网页40/40、构建/dist一致性、依赖禁入、工作流检查、短检查点专项2/2通过。

```bash
npm run check
node --check V6_BO/deploy/windows-host/host-runtime.js
node --test V6_BO/tests/windows-local-host.test.js V6_BO/tests/boot-snapshot-recovery.test.js V6_BO/tests/stream-recovery.test.js V6_BO/tests/device-access-persistence.test.js
python3 -m unittest discover -s tests -p 'test_windows_host_bundle.py' -v
RUNNER_TEMP=/tmp V6_MODEL_PYTHON="$(command -v python3)" V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node V6_BO/tests/full-server-isolated-smoke.js
```

## 交付边界与恢复

这是当前Linux隔离环境下对WSL启动器及真实Node后台的验证，不是Windows开机自启、WSL关闭后存活、手机真机或私网HTTPS验收。两路HTTP连接不冒称两个真实浏览器。未部署生产、购买服务、修改发布owner、迁移账户或接入券商；原24项现场验收保持未关闭。

回滚：revert本批提交即可，无账户/快照格式迁移。旧源码需要通过原启动器源码校验；不得为覆盖已安装程序而放宽hash、权限或原进程所有权校验。
