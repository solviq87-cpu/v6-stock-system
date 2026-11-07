# V6 20261107bo：候选池报价证据传递

唯一基线：V6_1083_full_20261106bn.zip，SHA-256 f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78；本环境重新取回并实际校验SHA与ZIP CRC。

## 问题与改动

精选池 scored.push、趋势池 trend.push、连阳池 syRaw.push 在复制 s.price 时没有复制同一个 s 的 quoteAt/quoteSource，导致bn显示模块即使在源行已有证据时也只能报未知。本批在这三个生产者同时复制同一行的报价证据，后续显示按当前时钟重新判龄。

src/core/quote-observation-view.js 新增 quoteSnapshotFields：仅白名单复制安全整数正原始时点、字符串来源（去两端空白，最多100字符）、接收时点（仅作接收记录）及显式canTrade=false。价格不是有限正数则丢弃原时点与来源；不把字符串价格强转成有效价格。不复制SDK私有字段，不授予canTrade=true，不造报价时间或来源。保留未来/旧原时点交由已有view标为future/stale，不把它钳到现在。

server.js 三处池构造同时引用此帮助函数。helper不接收全A列表、执行缓存或代码索引，不可能按同股票从另一价格借时间；复制结果为独立标量。原信号打分、过滤、排序、交易门槛与历史账户不改。

服务端、前端app、桌面HTML、手机HTML、SW五处版本及共用仪表盘侧栏统一20261107bo；桌面/手机主布局保留。

## 验证与边界

新增pool-quote-provenance.test.js七项：精确保留与隐私白名单、禁止从接收时间/其他报价补证据、15秒边界/旧/未来时点、畸形输入、三个生产构造真实代码前缀分别执行并接入dashboardView验证。源行后续换价/时间不会修改先前池快照，后续投影也会按原时间过期。

定向22项通过，0失败/跳过/取消；npm run check通过。首次准备阶段脚本检测到另一个scored.push同名用法而主动停止，未修改服务端；其间尝试的定向用例失败日志保留pool-quote-targeted-20261107bo.tap。随后以完整源片段定位目标构造，正式定向日志为pool-quote-targeted-final-20261107bo.tap。TAP必须显式选择tap reporter，首次准备日志不是正式TAP验收证据。

主工程完整1090项通过、0失败/跳过/取消、退出0，93719.716018ms；TAP完整性核验通过。干净包结果见本批最终TEST_REPORT/CHAT_HANDOFF。模拟和夹具不认证真实供应商盘中连续可用。

仍待：当前首选全A上游若本来没有逐票原时间，三类池继续未知；没有为全A新浪列表推造原时间。其他研究/信号/旧页/指数/板块/跨市场生产者还未全部审核。220只持仓监控容量、真实盘中持续更新与供应商权限、新闻/概率独立样本外/实际持仓闭环及短信/真机/长期云端/跨机灾备/真实策略效果继续待验收。

本批为完整工程代码更新；先前网页是只读历史样本预览，不能把本批代码测试当成完整后台已上线。不购买付费接口、不接真实券商。

运行：Node22.6+、Python3、Linux flock。先读AGENTS.md与integration/CHAT_HANDOFF.md；ML解释器按目标机指定：

```sh
V6_MODEL_PYTHON=/path/to/ml-python V6_TEST_CONCURRENCY=2 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 npm test
node scripts/verify-tap-completeness.js integration/pool-quote-full-20261107bo.tap
npm run check
npm start
```
