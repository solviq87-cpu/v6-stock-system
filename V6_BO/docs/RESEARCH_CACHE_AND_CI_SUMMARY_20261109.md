# V6 研究页发布缓存与 GitHub CI 验收追踪（2026-11-09）

## 原因
2026-11-09 新增的冻结策略审计、持续信号去重和板块横向研究已经合并代码，但 `public/research.html` 仍引用旧版 `complete-workbench.js?v=20261109qualityaudit4`。
浏览器和手机旧 Service Worker 可能继续显示旧脚本。应用原有 `APP_VER` 服务端、手机、SW仍使用 `20261107bs`。

## 修复
- 服务器 `server.js` 的 `APP_VER`、`public/mobile.html`、`public/sw.js` 同步为 `20261109cr1`；
  `public/index.html` 的核心入口和通用资源版本参数同步，触发浏览器缓存更新。
- `public/research.html` 的综合研究脚本使用 `20261109rps1`，确保出现新信号分段与横向板块分位展示。
- 修改仅针对版本标识，不动报价时点、权限、真实/模拟资金、原四套选股规则、回测算法或PWA缓存策略本身。
- 新增 `tests/research-cache-version-parity.test.js`，在完整 CI 中阻止服务端/手机/SW版本再次出现不一致。
- `.github/workflows/v6-ci.yml` 两个测试作业追加 `GITHUB_STEP_SUMMARY`：分别记录网页构建测试和后端语法/全量回归、14数据源离线登记、11主线预检、HTTP冒烟的真实步骤结果。**仅记录作业结果，不虚报生产部署。**

## 操作边界
GitHub Actions 运行摘要属于仓库的持续记录，自动跟随每次推送/PR更新，用户可以在 GitHub Actions 每条运行中查看步骤及摘要；它不是独立的线上看板，也不会自动写入 Workbuddy。

生产部署仍需独立的运行环境、受保护的凭据、HTTPS、持久化卷、健康检查与可回滚发布流程。CI结果不能证明中国大陆行情网络、真实提醒送达或者用户手机缓存实际清除成功；后两者必须在目标设备/环境完成端到端验收。
