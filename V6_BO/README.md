# 量化看盘平台

> **国内写入/部署目标（2026-11-09 用户指定）**：`https://acd98a1c1a46e6ce4.app.workbuddy.host`，文档 `/api/ai/doc?id=ai`。下一位 AI 必须先读 [`docs/CHINA_WORKBUDDY_WRITE_TARGET.md`](docs/CHINA_WORKBUDDY_WRITE_TARGET.md)，不要照抄下文旧部署地址或在 401 未授权时猜测写入接口。

A 股量化盯盘与选股系统：多数据源行情采集 → 四维度选股打分 → 飞书/邮件推送 → Web 面板可视化。

> 🆘 **接手/恢复先看 `RESTORE.md`**（下载、重建、忘口令、一键脚本都在里面）。
> 🧠 **动手改代码前先读 `.workbuddy/memory/MEMORY.md`** —— 项目铁律、踩过的坑、发布流程都记在那儿，
> 那份笔记在磁盘上，删掉聊天对话也不会消失。

## 八字选股口诀

核心选股体系（见 `bazi.js`），四个维度加权：

| 维度 | 权重 | 看什么 |
|---|---|---|
| 趋势 | 30% | 均线多头排列、ma20 方向、是否回踩不破、板块节奏 |
| 资金 | 30% | 主力流向、连续流入/流出、涨停基因、回调后拉起 |
| 位置 | 20% | 启动位 / 洗盘位 / 底部蓄势 / 破位整理 |
| 承接 | 20% | 下跌是否缩量、能否守住 ma20、收盘位置、长下影天数 |

**一票否决**：被判为「高位加速」或「破位整理」的标的，直接拦下，不进候选池、不推送。
缺数据的维度按中性 50 分计，并标注 `insufficient` —— 宁可承认证据不足，也不编造。

设计原则：不另起炉灶算指标，全部复用 `analysis.js` 已有的
`bigMoneyContext` / `volPricePattern` / `isLimitUp` / `computeLevels`。

## 目录结构

```
server.js      主服务（HTTP + SSE + 定时调度 + 推送）
bazi.js        八字选股引擎
analysis.js    技术指标与趋势/大单环境判定
em.js          行情数据源（东财 → 腾讯 → 同花顺 三级降级）
learnall.js   自主学习引擎（形态 → 涨停概率）
ztpre.js      涨停前形态挖掘
myrules.js    自定义规则
logic.js      归因解释
public/        Web 面板（单页）
_test_*.js    守门测试（每个特性都有对应用例）
```

## 数据源三级降级

1. 东方财富 —— 主源
2. 腾讯 —— 兜底
3. 同花顺 —— 二次兜底

科创板（688/689）腾讯返回的成交量单位是「股」而非「手」，相差 100 倍，已在 `em.js` 归一化。

## 安全约定

`.gitignore` 内含「凭据红线区」，以下文件**永不入库**：

- 含明文开发者口令的脚本（`_publish.py`、`_post_publish.py`、`_restore_local.py` 等）
- 运行时令牌与密钥（`config.json`、`access.json`、`*_tok.txt`、`.online_machinekey`）
- 私密业务数据（`holdings.json`、`.holdings_ops.json`）
- 工作区记忆（`.workbuddy/`）

运行期凭据统一从 `config.json` / `access.json` 读取，源码里不留密钥。口令判定使用
`scryptSync`，设备令牌带世代号，改口令即作废旧令牌。

## 运行

```bash
node server.js      # 默认 8787 端口
```

面板打开后需验证开发者口令；被授权的设备会拿到长期令牌，后续免密。

## 从本仓库恢复（备份怎么用，别踩坑）

本仓库是**源码备份**：`server.js`、`holdings.js`、各功能模块、`public/`、`_test_*.js` 全部齐全，
`git clone` 后代码是可以跑的。但下面这些**刻意不在仓库里**，需要另外补（见上一节的安全约定）：

| 缺什么 | 为什么不在 | 怎么补 |
|---|---|---|
| `config.json` | 含飞书机器人地址 / 邮箱授权码 / 同步令牌 | 在线上面板重新配置；发布流程的第①步会自动从线上拉回 |
| `access.json` | 含开发者口令哈希与设备令牌台账 | **重新设置口令**（不要回填旧哈希，旧哈希本身也是泄漏面） |
| `holdings.json` | 持仓含成本与仓位，属私密 | 线上面板「持仓 → 变更记录 → 一键还原」 |
| `_publish.py` / `_post_publish.py` 等 | 脚本内含明文口令 | 不入库是有意为之；如需发版流程，按线上现有部署重建 |
| `news.json` / `stats.json` / `learnall.json` / `ztpre.json` | 运行时数据快照，体积大且可自动再生 | 从线上拉回（发布脚本第①步会拉）；拉不到也能自行重建，只是学习样本从零开始 |
| `.kline_cache/` | K 线缓存，可再生 | ⚠️ 不发它会出现「K 线拉不全」，发布时必须随包带上 |

恢复步骤：

```bash
git clone <本仓库地址>
# 补上表中的 config.json / access.json（其余可自动再生）
npm install
node server.js        # 默认 8787 端口
```

⚠️ 克隆下来的实例默认是 `primary`（会外发推送）。只作开发/预览时务必在 `config.json` 里
写 `"pushRole": "replica"`，否则会和线上实例**双份推送到手机**。


## 2026-11-05 安全接入：可信反向代理 IP 配置

云端部署必须设置 `QD_CLOUD=1`（**关闭 localhost 免密**）。服务端默认只使用 TCP 连接对端地址识别认证限流 IP，任何直接发送的 `X-Forwarded-For`/`X-Real-IP` 都不可信。只有在确认反向代理真实源地址后，才配置 `QD_TRUSTED_PROXY_IPS`，如 `127.0.0.1,::1`；这是**逗号分隔的可信代理 IP 列表，不是允许访问的客户端 IP 范围**。代理需要追加真实客户端连接地址（或覆盖客户伪造的头）。不同拓扑需现场联调。未配置时，经过单个代理的用户可能共用限流桶，但不会由客户端自己选择限流 IP。

本地回归：`node --test --test-concurrency=6 --test-force-exit tests/*.test.js`。模型回归需要 `tools/requirements-models.txt` 里的 Python 依赖；可用 `V6_MODEL_PYTHON` 指定安装依赖的解释器。运行失败不能等同于策略真实收益失效，需先区分环境依赖与逻辑回归。

最新测试、部署风险及待办见 `docs/V6_本轮_可信代理与设备持久化_全量测试报告_20261105.md` 与 `docs/V6_十一大工程_最新进度与真实未完成项_20261105.md`。
