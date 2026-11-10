# V6 因子自动学习：完整研究证据链与只读运行诊断（2026-11-10）

## 为什么需要这一步

此前PR #58–#65分别实现了信号冻结、逐票因子证据、BaoStock受控研究导出、授权历史价转换、未来观察、五日成熟归档、行业中性化及影子研究模型。即使每个模块各自测试通过，若版本衔接错误，依旧可能在不同环节混用旧价格、不同时间的原始数据或未成熟观察。

本次没有购买行情、部署WorkBuddy或偷偷接实盘，而是把这些**现有真代码路径**放进同一集成回归测试，并增加一个面向实际私有归档目录的**纯只读运行状态检查**。

## 一键运行完整合成证据链回归

在V6_BO工作目录：

    npm run test:factor:chain

此测试完全离线、无BaoStock联网、无行情许可请求、无账户下单，使用显式标记为合成的股票/交易日/因子证据。真实调用：

BaoStock原始字段协议数据→ normalizeBaoStockBundle / baostock-eod-research.js → adaptAuthorizedHistory / authorized-factor-market.js → factor-source-preflight → factor-eod-capture.js → factor-maturity-link.js → factor-horizon-neutral.js → factor-shadow-worker.js的样本不足门禁。

断言：首次日线数据不能偷看未来H5；第五交易日后才允许封存成熟观察；只有一个独立成熟日时模型不会自动训练；旧时点原收盘价即使仍符合OHLCV也不能悄悄回写；原始信号重冻结必须拒绝；已归档文件哈希被篡改必须拒绝；只有私有路径可用。

完整回归继续运行：

    npm run check
    npm test

这些合成测试只验证数据协议与防负优化的技术基础，不证明真实A股交易日、上游合规授权、历史行业分类准确性或真实模型收益。

## 当前工作区只读状态

在操作者已经把研究文件放在私有持久卷后，可以执行：

    npm run factor:chain:status -- /srv/v6-private/daily-captures /srv/v6-private/tracking /srv/v6-private/manifest-current.json /srv/v6-private/shadow-models

没有任何采集时，结果是 no-captured-evidence；已有冻结但H5尚未成熟是 awaiting-h5-observations；价格成熟却缺少训练目录是 manifest-not-published；当前成熟证据比已发布索引更新是 manifest-needs-refresh；有效不同交易日低于36标记 insufficient-independent-h5-days；超过36日仍未接受研究版本是 shadow-model-not-accepted；存在历史已接受影子研究版时是 shadow-research-version-present。

输出包括信号冻结日数、完整H5成熟日数、未观察或未成熟日数、封存manifest的独立日数、达到最小36日尚缺多少天、独立研究模型版本。**这些只是本地归档和自报数据的完整性状态，eligibleForTraining始终为false**：真正训练还需独立的行业/市场条件、训练验证与新增样本外门禁判断；状态工具不代替模型晋级评审。

任何manifest都要检查SHA完整性，逐日冻结必须有对应签名与原cohort重算，manifest只能引用本目录中最早的完整5日成熟不可变观察版本。若SHA被篡改、引用不匹配、试图在公共目录存放研究证据或路径包含符号链接则直接报错。状态脚本不会新建目录、读账户、调用供应商或修改研究归档。

## 无法伪称已完成的事项

本次仓库合并不表示BaoStock在真实运行环境中已合法授权、网络可达，也不表示WorkBuddy服务已配置或部署成功。只读结果的字段 authorizedProviderIndependentlyVerified:false、liveQuotesVerified:false、cloudDeploymentVerified:false 和 shadowModelProfitabilityVerified:false必须保留。真实数据库/采集时间和券商Level-2的许可需分别验收。两张锁定主页、四套正式策略、正式因子权重、模拟盘账本与云端服务仍保持原样，不接实盘。