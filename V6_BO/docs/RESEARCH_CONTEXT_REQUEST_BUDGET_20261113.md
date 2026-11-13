# 个股观察上下文的共享请求预算补充

基线 `9846b03212658621cff17de3efe6b83c93405f4a`。只处理实查的三条活动默认传输：`public-market-context`、`public-stock-status-evidence`、`eastmoney-current-board-members`。观察队列的 `includeContext:true` 会调用它们；这不是对仓库所有采集器或线上独立浏览器页面的全覆盖声明。

新增 `research-curl-bytes.js`，供这三个模块在原有地址/参数白名单之后调用。默认真实 curl 使用同一 `marketRequests` 生产单例，因此与已有 em、历史及全市场快照共用家族启动间隔、在途槽、队列和持久冷却。异步临时目录准备在预约之前；预约覆盖完整传输及有界体读取。头stdout限制64KiB，私有临时体限制2MiB，解析最终HTTP头的状态与Retry-After；不重试、不跳转、不换同家族主机或传输。子进程或响应体失败不能掩盖已收到的429/403，cleanup不能覆盖restriction。

模块继续返回partial/unknown及已取得的原始证据，错误新增结构化状态和冷却终点；板块错误原有`code`仍表示板块身份，新增`errorCode`表示限制分类。其余同家族请求由governor停止，东财限制不取消腾讯独立证据预算。保留原始body字节、哈希、接收/knownAt、供应商原日期和f124，不将限制体解析成正常行情，也不把未知数据补0。市场上下文仍返回兼容的raw字符串，同时单独保留rawBytes Buffer用于归档；无效UTF8字节不会因文本解码/重编码而改变证据哈希。

状态证据原35秒、8次、2个本地并发，板块原45秒、20次、2个本地并发及8MiB总字节上限保留。总采集时限包括排队，wire超时在真实派发时按剩余总时限重新计算；取消或过期的排队任务不会迟发curl。纯本地适配器使用无真实等待、无持久化的内存门禁；显式注入`requestGovernor`可用假时钟验证共享预算。真实自定义适配器须注入生产共享governor。

验证：新增`tests/research-context-request-budget.test.js`，覆盖三默认客户端共用预算、429/403停止分页/后续同族请求、腾讯独立预算、HTTP日期Retry-After、精确原始证据、完整body占槽、预处理时点、排队取消/过期、字节边界及cleanup错误。新增及三客户端原专项在全禁网络/子进程preload下49/49通过，attempt/blocked均0；档案、市场上下文watch及个股观察消费者专项在仅允许隔离Node/loopback的外部禁网门禁下72/72通过。

本地证据在`/workspace/rate-output/context-*`；整合前旁路反例在`integration-review-bypass.txt`。最初将一个旧跨进程归档测试放入全禁子进程组合，该本地Node spawn被拒、没有出站，日志保留且未当作通过；随后在允许隔离Node的门禁重跑档案测试通过。

未修改em、已验证的历史/快照客户端、server、主页、账户或部署。回滚可撤销本提交，不删除既有来源档案或有效冷却记录。供应商许可、真实网络持续可用性和线上页面仍需独立验收。
