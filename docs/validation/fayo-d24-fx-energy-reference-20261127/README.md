# D组第三十二批：原D24外汇与商品研究数据补缺（2026-11-27）

## 原编号依据与范围
此前 #455 交接 README（精确头 5baad1459a7ba323119e2bc447a1802f215bf8f4）明确指出 D24 为外汇/商品，真实接通与权限待办。此轮不再反复测试已覆盖的60个编号，新增该编号的具体功能。原78项任务书仍未完整恢复，暂不推断其余17项的标题。
基于 D组 #518 精确头 1a8035142ba7420ce59447d188b0339f895ce78e，包含 #473/#475 原存证修正与既有历史测试。只增加现有官方背景数据的研究读取能力，不建立第二个数据中心、日志或账户。独立候选，不修改 #526 原60项主线、原PR头或工作流，不合并、不部署。

## 六项实际开发和验收
1. EIA APIv2 原油现货日频适配器，固定官方 HTTPS 路径、固定 RWTC/RBRTE 两个序列、单次有限范围 GET；仅在显式提供合规 API key 后调用。
2. 供应商回执的日期、序列、频率、原币/桶单位、声明行数、缺失值、负值及零值校验，不以期货或即时行情替换。
3. 无密钥拒绝派发、401/403/429及非完整HTTP200不重试或绕过；禁止跟随重定向、异常字节/时钟、凭据回显及未识别响应。CLI只从环境变量 V6_EIA_API_KEY 读取密钥，不把密钥写到源码、日志或回执。
4. 原私有 market-data-evidence 背景存证扩展 us-eia，沿用既有 raw SHA-256/事件链/版本/历史时点读取；遇已知凭据字段或本次密钥回显拒绝保存（若实际官方响应有此字段，即保持失败关闭，不声称已获真实回包）。
5. ECB原始两腿归档的交叉参考汇率读取（例如 USD/CNY、USD/JPY），只同日合成；任一腿不在决策时点可见时拒绝，缺日保留null，来源仍为单一ECB。不是可成交外汇报价。
6. 复用 readBackgroundOverview 返回原油实际日期及USD/barrel口径；加手动CLI、六项正式node:test，保留既有100项。没有改原候选登记的启用/授权标志；us-eia仍为credentials-required、candidate，静态接线审计和双端实际消费需总管后续统一更新。

## 官方依据（本轮实际核对官方页面）
- https://www.eia.gov/opendata/ ：免费开放能源数据，API须登记并遵守服务条款及复用政策。
- https://www.eia.gov/opendata/documentation.php ：APIv2路径、api_key、频率、日期、facet和分页total。
- https://www.eia.gov/opendata/browser/petroleum/pri/spt?data=value&facets=series&frequency=daily&series=RWTC%3B
- https://www.eia.gov/opendata/browser/petroleum/pri/spt?data=value&facets=series&frequency=daily&series=RBRTE%3B
- https://www.eia.gov/dnav/pet/hist/RWTCd.htm / https://www.eia.gov/dnav/pet/hist/RBRTED.htm ：原WTI、Brent现货历史数据，单位美元/桶。
- https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.eu.html ：ECB信息用途的欧元参考汇率，不用作交易。
本轮只查阅官方公开网页，不注册用户账号、不请求凭据、不发送真实API请求。响应schema/units支持范围依据文档及受控测试，待持有效key真实验收。

## 实际原生验证
Node.js v22.16.0，Linux fs/crypto/flock、Response与字节流使用实际Node内置实现，供应商响应为夹具。新6项6/6通过；同一隔离目录旧100项+新6项实际一次执行106/106，0失败、0跳过、0取消，约1.69秒。核心代码和测试原始Git blob一致：
- eia-spot-daily.js 6bb729a3750e0764001b4b331615b0f50aa6c853
- ecb-cross-reference.js 9e384480573a8f4b2d3eb4410f709bd512caa48a
- market-data-evidence.js aa7b1cd66de7aa35901235e41e353af4899a393d（原88de33dfeb556c77c2f9a3abd5c29cbcba0498f6）
- collect-eia-spot.js 75109bd49d1dd4749a9ef9956fcdb08aff6917a9
- fayo-d24-reference-market.test.js d5f7229f6f64e7e391b0f410ef08782820a7ab29
- 原ecb-fx-daily.js fc5bba99a8379e456726c90c57006e4f3180ae59，未修改。
本地使用第29批原生隔离工程，目录原15条相关路线再添加仓库精确ECB/us-eia两条登记（17条局部目录，blob afeeab04bdfa1fdb1401aaff1a85f019e68e05c6），远端保留完整122条原目录，未覆盖。原四个未调用的回测/账户依赖保留抛错桩，原69项中的边界夹具未变化。本次新6项实际调用原存证和锁、ECB生产解析、EIA新解析。非全量仓库CI、非真实供应商联网、非真实授权。
完整仓库专项命令：cd V6_BO && node --test tests/fayo-d24-reference-market.test.js
复跑既有100项沿用 #518 第29批验收清单。手动EIA命令：在合法注册、按本地环境安全设置V6_EIA_API_KEY后，node scripts/collect-eia-spot.js RWTC <起始日> <结束日> <原私有存证绝对目录>。不把实际密钥粘贴到聊天、命令参数或Git。
ECB交叉读取API：readEcbCrossAsOf({root,baseCurrency:'USD',quoteCurrency:'CNY',start,end,decisionAt})，要求两币种已在原归档中存在完全相同日期范围的scope。

## 原编号进度
原60项覆盖来自前序交接；本轮新增真实D24部分整改证据，故去重覆盖 61/78（78.21%），17/78 待核对或继续，完整验收确认仍0/78。D21–D30部分覆盖10/10，其余区间不变。此次不是把6个小任务当成6个原任务，也不意味着D24完成了实时外汇、贵金属、有色金属、期货、实际源连接及策略消费。剩余原编号 D05/D06/D07/D11/D42/D46/D47/D50/D51/D52/D65/D67/D68/D69/D71/D72/D75；须依照原文核对，不推测标题。D42前序 #460 明确为四套策略正式接线，待总管协调。
