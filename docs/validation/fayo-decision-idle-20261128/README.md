# 首页隐藏/离线刷新：原机制的定向优化（候选，未部署）

本批沿原#562，父 `86da6ec5064e5e5eee048f4a17900f2c41d361b9`，总管 dev `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`。复用 `public/nova/decision-view.mjs` 的原5秒本地重验和原 `ctx.loadDecisionCenter()` 的缓存/单飞，不新增调度器、API、模型、采集或通知。最终提交、当前CI及隔离组合单独登记。

## 实际问题及取舍

原首页定时器在页面隐藏时仍执行 `paint()`，在页面可见但网络离线时仍调用后台决策读取。原服务、原鉴权、固定时钟和同样空候选输入下，三种屏宽的修前隐藏10秒均产生4条DOM变更；离线15秒观察到2—3次决策接口尝试（受异步回执影响，逐宽计数见原始JSON）。DOM变更不是CPU占用或完整绘制次数，不能外推整体性能比例。

在原定时回调内增加可见/在线条件，并在恢复可见、网络恢复时立即按原投影重验。隐藏时不周期重绘，不再由状态到达回调启动下一次隐藏决策读取；可见且离线时仍按原5秒节奏核验旧包，防止为了省算停止时效和连续竞价状态检查。**没有取消原5秒定时器本身**，也不以本批宣称节约了CPU/内存。

浏览器在线标志只是粗粒度提示：原首次读取、成功取得本地后台状态后的读取保留，网络标志为离线但本地服务实际可达时仍可启动研究页面。后台持仓风险、行情、账户、账本和原15秒执行报价门禁未改；这是前端自动读取/重绘优化，不暂停后台安全任务。离开工作区或撤销会话后按原信号清理定时器及新增可见/在线监听。

## 验证及消费

消费者为原PC与手机首页决策工作台，不加菜单、不做最终UI重设计。复用已有F13.2/F23.4查看时效合同及效率指令18/21/23；本批不认领F14.1/F38.1完整能力或新增完成项，228项仍36局部/192待验/0完整签收。

- 实际原服务/原鉴权和Chromium 1366/390/320三屏宽：修前隐藏DOM变更4、离线决策读取尝试2—3；修后均0。恢复可见时立即重验；离开工作区后可见/在线事件不恢复原决策读取。各窗口分别10秒/15秒，同输入、浏览器及硬件条件。
- 另在三宽中模拟 `navigator.onLine=false`，但保持本地传输实际可达，原首次 `/api/decision-center` 均HTTP200。合计6条浏览器流程；不是物理断网取得实时数据或真实手机验收。
- 候选为空，没有虚构股票、收益或成交。可见性和时钟为隔离控制，实际截图来自原软件；服务器和浏览器均禁止外部来源。真实持仓风险、网关、大陆线路及前向价值仍待，不把空账户流程当资金守恒实证。
- 关联62项、内核禁止联网38项、原静态检查通过。本批源完整原生8134/8134、零失败/跳过/取消，158399ms；源码指纹与原始日志哈希见`full-summary.json`，没有移用旧8134。原 `readDecisionBoard`、`stockConclusion`、共享报价/风险/账本代码未变。

## 复现及回退

在 `V6_BO` 使用已有运行环境：

```sh
FAYO_STUDY_RECEIPTS=/tmp/fayo-idle-replay node ../docs/validation/fayo-decision-idle-20261128/native.cjs
FAYO_STUDY_RECEIPTS=/tmp/fayo-idle-parent FAYO_IDLE_BASELINE=1 node ../docs/validation/fayo-decision-idle-20261128/native.cjs
node --test tests/fayo-decision-model.test.js tests/fayo-simple-picks.test.js tests/fayo-polling.test.js tests/fayo-view-expiry.test.js tests/decision-sector-context.test.mjs tests/decision-sector-context.test.js
python tests/helpers/deny-network-connect.py node --test tests/fayo-decision-model.test.js tests/fayo-polling.test.js tests/fayo-view-expiry.test.js tests/decision-sector-context.test.mjs
npm run check
npm test
```

基线模式只在临时服务副本还原上述父提交的 `decision-view.mjs`。`python` 使用已有Playwright环境，Chromium固定 `/usr/bin/chromium`。回退仅源码，保留全部账本和研究历史；由原总管统一集成/发布，本批未合dev、未部署。
