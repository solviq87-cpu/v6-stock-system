# 完整服务烟测的运行隔离｜2026-11-13

基线 `9f322e1479b458d230b37b212a562d2d09c84a07`。原 `tests/full-server-isolated-smoke.js` 虽设置 `V6_ISOLATED_BOOT_SMOKE=1`，仍以源码目录为 cwd，模块初始化会在源码的 `data/order-accounts` 写入账户与锁文件。跳过采集启动不等于没有运行写入。

本批仅修改测试 harness，不改变生产 boot 语义。现有真实 HTTP 首页、选股/竞价/参考图页面、JS/CSS、404、锁状态以及无凭证列设备/撤权拒绝断言全部保留。

现在先建立临时目录，仅复制 `src`、`scripts`、`strategies`、`public`、`package.json` 与根 JavaScript 代码，以及公开的 `config/data-source-catalog.json`、`config/six-photo-sources.json`。不复制原访问配置、账户、缓存、日志或其他配置。访问配置使用随机盐和随机测试秘密的 scrypt 派生值合成，不读取源码访问配置内容。

子进程在副本 cwd 启动，使用最小显式环境，不继承凭据、`NODE_OPTIONS` 或业务数据路径；TMPDIR 与订单账户目录均位于副本。测试预加载防护拒绝读取源码目录、在副本外写文件，以及 HTTP/HTTPS、socket、TLS、fetch 或非本地 DNS 请求。只允许绑定回环服务时对字面回环地址的本地 lookup，以及既有账户锁对副本内文件描述符执行精确的 `/usr/bin/flock -n 3`；其余子进程拒绝执行。这是测试防护，不是生产沙箱或通用主机隔离证明。

源码 `data` 树及根非 package JSON 文件仅记录名称和文件元数据，不读取私有内容；退出后核对清单完全一致。所有正常和异常路径都先结束子进程，SIGTERM 超时再 SIGKILL，然后删除整个临时目录；同时断言临时目录已消失、防护没有拒绝记录。

已实际执行：

```sh
node tests/full-server-isolated-smoke.js
node --check tests/full-server-isolated-smoke.js
git diff --check
```

结果通过；日志在交付工作区 `/workspace/remaining-output/smoke-isolation.log` 与对应 `.exit`。未在本批执行全量回归，也未读取或清理生产账户。回滚仅需回滚测试与本文档；建议保留隔离改动，避免恢复源码目录烟测写入。
