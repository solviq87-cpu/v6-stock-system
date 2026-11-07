# 启动、接口、部署及恢复

## 本地与Linux服务
Node22.6+、Python3、util-linux flock；真实服务使用北京时间 `TZ=Asia/Shanghai`。执行 `node server.js`，先在本机设置管理员并审批设备。
部署以deploy/v6.service为systemd模板，deploy/nginx.conf.example为HTTPS反代模板；编辑目录、域名、证书，服务使用非特权用户。生产环境文件0600，不把真实口令写进工程。
可信代理仅明确列出的回环/实际反代IP：QD_TRUSTED_PROXY_IPS；QD_PUBLIC_URL填写自己的HTTPS站点。公网证书、安全组、负载与生产日志尚未现场验收。没有购买云资源。

## 统一订单账户接口
POST `/api/research/order-account`，必须开发者Bearer令牌。`accountId`只能1至40位字母数字下划线/短横线。默认存储data/order-accounts，V6_ORDER_ACCOUNTS_DIR可改。
操作：initialize(initialCash)、submit(order)、fill(orderId/eventId/quote)、cancel(orderId/eventId)、read。
order字段：orderId/symbol/side/quantity/limitPrice/tradeDate。
quote字段：symbol/source(imported或simulated)/tradeDate/timestamp/volumeUnit(shares)/volume/price/upperLimit/lowerLimit/suspended(false)/tradable(true)。客户端提供的快照始终是研究输入，不会因为填写provider就标为真实认证。
成交必须有明确导入的交易日历：V6_TRADING_CALENDAR_FILE。未提供或覆盖不到当日时拒绝成交。格式详见src/core/trading-calendar.js及原部署说明；绝不以周一至周五猜交易所开市。
量参与率默认1%，费用默认研究配置：佣金3bps、最低5、卖出税5bps。此为明确可改的研究假设，不是对当前券商/交易所费率的认证。费用策略在建账时固化；日后应使用适配真实生效日期的已核对政策。
每个账号只有一个原子快照，同时保存订单状态和资金/持仓。Linux .guard为内核锁载体，文件留存正常；不得删除正在运行的guard。历史.lock存在时先停止服务核验写者，不能按时间粗暴删锁。
账户文件和其目录应仅服务用户可写。签名/恶意管理员篡改不在普通哈希保护能力内。

## 其他接口
完整研究 `/api/research/complete-run`；可恢复历史模拟账户 `/api/research/paper-account`；静态数据来自 `/api/state` 和 `/api/mobile-digest` 的同源dashboard投影，K线仍调用 `/api/kline`。
旧A/B账户分别对应权威pool.json与pre.json；新订单API使用accountId=pool/pre，CLI指定相同路径，即共享现金、批次和事件。paper.json是兼容投影，损坏时可从完整权威账户重建；没有权威备份而旧文件损坏时拒绝重置初始资金。重置/改本金会归档原订单账本；副本不进行权威迁入或自动写账，只同步展示。离线研究会话是独立实验，不能与实时账户余额相加。

## 备份及恢复
停止账户写入后：`node scripts/disaster-recovery.js backup <新备份目录> <状态文件...>`；`verify <目录>` 验证；`restore <备份目录> <不存在或空恢复目录>`先预演，再加--apply恢复。
加密：通过私密环境变量提供V6_BACKUP_PASSWORD（至少16字符），运行 `node scripts/secure-backup.js encrypt <已验证备份目录> <新加密文件>`。
解密：`node scripts/secure-backup.js decrypt <加密文件> <不存在的恢复目录>`；只有认证、清单、逐文件哈希均正确才发布目录。口令不写入命令参数。
包含access、设备、会话、订单账户、旧模拟盘、策略配置、必要行情元信息；锁文件不作为恢复业务数据。备份应移至不同故障域并私密保管密钥。本轮加密往返测试在本机完成，未冒充异地RPO/RTO。

## 可选模型与云备份
AI仅代码接口，未配置任何模型。可选云备份配置：V6_CLOUD_BACKUP_ENDPOINT、V6_CLOUD_BACKUP_OAUTH_URL、V6_CLOUD_BACKUP_PUBLIC_KEY；还需供应商SDK与实际访问授权。默认本地保存，未配置不发送到旧默认地址。
SDK是可选依赖；npm ls记录可复现。没有执行联网漏洞数据库扫描，不宣称供应链已完成外部安全认证。

## CLI共享账户
`node scripts/paper-account.js /opt/v6/data/order-accounts/pool.json /path/to/request.json`；请求格式与统一订单API一致。成交需要V6_TRADING_CALENDAR_FILE。不要在CLI另指一个文件后以为它仍是同一个A盘。

## 旧盘迁入及回滚
首次启动将有效paper.json的现金、持仓和历史流水明确作为期初状态保留，不伪造历史逐笔订单。迁入后自动成交写入同一订单/批次/资金事件快照。期初持仓无可靠买入日期或旧文件损坏时安全失败，需人工核对原始备份。先停服务并备份paper.json和整个order-accounts目录再升级；不可仅回退paper.json覆盖已提交的新账本。真实多主机迁移仍待现场演练。


## 当前合并版本补充
当前20261105aj，以CURRENT_MERGE.md为最新差异记录。费率/风险配置见FEE_RISK_CONFIGURATION.md；无需凭证即可运行隔离自动化测试，真实行情/短信/生产部署仍需原有外部条件。备份须包含权威账户快照及配置，勿仅恢复兼容paper.json。恢复前停止所有写入进程，沿用既有验证恢复流程。


## 全库合并20261106ak
当前启动目录为v6；history目录只用于历史追溯，不作为运行目录或覆盖配置。新增研究CLI见package.json，部署环境仍按本文准备。正式备份应包含权威账户及配置，恢复前停止全部写进程；不要用旧历史样本覆盖账户。全库差异和新CLI功能见ALL_LIBRARY_MERGE_REPORT.md。


## 20261106al 补充
本次新增功能和操作边界见DEVELOPMENT_STATUS.md及POLICY_SETTLEMENT_OPERATIONS.md，交接入口见CHAT_HANDOFF.md。云电脑未接入，现场部署未验收。审计文件须随权威快照备份，不启动历史写入器。


## 20261106am 审计轮换补充
已补不可变段+原子索引切换、自动活动段轮换、轮换中断恢复和账户/审计一致备份恢复CLI，操作与上限见AUDIT_ROTATION_OPERATIONS.md。原文8MiB写满后只能手动处理的状态以本补充为准；超在线历史上限仍需离线迁移。尚未真实云端/跨机/长期留存验收。
