# V6 BP GitHub 更新（2026-11-07）

基于 `solviq87-cpu/v6-stock-system` 的 `dev` 分支提交 `f0d25873d4b64f61b0e864bbf7955298448a8a3f`；`main` 仍为初始化README，本批沿用dev，不覆盖其他分支。

## 本批修复

- 仓库根package.json原样指向根server.js和scripts，但实际代码在V6_BO，根目录运行会找不到文件。现全部已有npm脚本转发到V6_BO，并保留原命令名称和参数透传；根包不重复安装应用可选依赖。
- Dockerfile补Python3、curl、util-linux/flock和CA证书，对应原工程的Python桥接、HTTP备用通道和文件锁。未在镜像写入账户、口令或凭据；原.dockerignore保留。
- 修正IMPORT_STATUS中已过期的“源码未导入”说明。按BO档案逐项核对1093个JS/HTML/CSS/Python源文件都已存在于dev，未导入档案内的运行状态、日志或账户数据。所有原仓库文件先按GitHub blob SHA校验，再增量修改。
- 五处应用/缓存版本及共用仪表盘侧栏同步20261107bp；不改策略打分、排序、行情门禁或账户历史。

## 实际验证

本地仓库根npm run check通过；根入口定向2项通过。通过根npm入口跑完整回归1092项通过、0失败/跳过/取消、退出0，49624.830264ms，TAP完整性核验通过。14源登记离线审计通过（不是14源全部联网）。完整server.js隔离HTTP启动及认证拒绝冒烟结果随本次交接。

环境没有Docker可执行文件，因此未实际构建或启动容器。新增依赖的镜像安装、可选ML/行情SDK、目标机网络/数据许可/存储/HTTPS仍需在目标服务器验证。现有GitHub CI会因dev提交自动触发；其最终状态以GitHub Actions页面为准。本批没有配置服务器部署凭据，没有自动发布生产，也没有购买服务。

运行：仓库根npm run check；指定有NumPy/scikit-learn的V6_MODEL_PYTHON后npm test。容器从V6_BO构建。运行前继续按AGENTS.md及WEB_PREVIEW_DEPLOY.md配置独立私有状态与权限。真实盘中连续行情、其他价格消费者治理、新闻、样本外概率、持仓闭环及现场验收仍待。
