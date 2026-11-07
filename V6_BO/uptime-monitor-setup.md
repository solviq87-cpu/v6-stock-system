# 外置 Always-on 探活监控方案（C1）

> 2026-10-17 · 本轮角度：让「线上进程被回收 / 定时推送漏推」从**无声故障**变成**有告警、有记录**。
> 北极星关联：胜率命中率的前提是「该发的复盘 / 竞价 / 一进二真的发出去了」——漏发一次，当天的交易机会就直接归零。

---

## 1. 定位：这套监控解决什么、不解决什么

**解决：**
1. **用户电脑关机 / 休眠时兜底唤醒。** 本机副本（8787）每 3 分钟打一次线上 `/api/lock/status` 保活（server.js `startSelfWake()`），但副本依赖「用户电脑常开、本地服务常驻」。电脑一关，这条保活链就断，休市期间线上容器随时可能被回收。
2. **漏推告警。** 进程被回收 → 所有定时器整体停摆 → 复盘 / 竞价 / 一进二静默不推。gn 轮（2026-10-13）实证：10-12 线上全天 pushlog 0 条，复盘 23:58 算完了却没推出去，**全程无任何报错**。外置探针至少能让「它死了」这件事当天被发现。

**不解决：**
- ⛔ **救不回「已经死了」的进程。** 自唤醒只能让【活着的进程】继续活；进程已被回收时，服务端自己的定时器同样死了，没有任何东西能拉它回来。这也是为什么必须外置：只有**进程之外的**心跳才能先于托管平台的回收阈值把容器唤醒（任何一次 HTTP 请求都会触发冷启动）。
- 不监控「推送内容对不对」。本方案只保活 + 探活；信号质量由守门套件和学习库负责。

---

## 2. 监控目标与判据

| 项 | 值 | 说明 |
| --- | --- | --- |
| URL | `https://quant-dashboard-77614.app.workbuddy.host/api/lock/status` | 线上主实例（pushRole=primary） |
| 方法 | GET，无令牌 | 该路径在 isAuth 公开白名单内（server.js L14416），匿名可访问 |
| 判据① | HTTP 200 | 容器活着且在服务 |
| 判据② | 返回体是合法 JSON 且含 `"pushRole":"primary"` | 防「网关返回 200 但业务进程没起来」 |

**匿名返回体实测（2026-10-17，线上）：**

```json
{"hasPassword":true,"hasViewPassword":true,"local":false,"role":null,"boundPhone":null,"appVer":"20261016io","pushRole":"primary"}
```

- 匿名请求**不会**拿到 `gen` / `viewPwd` / `devPwd` / 设备台账等开发者字段（这些只在 role==='edit' 时下发，见 server.js L15448 分支），暴露面安全，适合外置 SaaS 直连。
- ⛔ **不要把 `appVer` 当关键词判据**：每次发布它都变，会把正常升版误报成故障。关键词只用 `pushRole":"primary"`。

---

## 3. 主方案：UptimeRobot（推荐，零依赖）

免费版够用：50 个监控位、5 分钟检查间隔、邮件告警联系人。

**配置步骤：**

1. 注册 https://uptimerobot.com （免费档即可）。
2. **Add New Monitor → 类型选 `HTTP(s)`**。
3. **Friendly Name**：`quant-dashboard-primary`。
4. **URL / IP**：填 `https://quant-dashboard-77614.app.workbuddy.host/api/lock/status`。
5. **Monitoring Interval**：`5 minutes`（免费版最短就是 5 分钟；配合副本的 3 分钟保活，实际暴露窗口 < 5 分钟）。
6. **Alert Contacts**：加一个常用邮箱（免费版可用邮件；Telegram / Webhook 等属付费能力，按需）。
7. 保存后先看一次状态：应为 **Up**（刚配好 1-2 分钟内出结果）。

**关键词判据（可选，付费版能力）：** UptimeRobot 的 Keyword Monitoring（"Keyword exists: `"pushRole":"primary"`"）在免费版**不提供**。免费版只有 HTTP 200 判活。如果要求「返回体也必须对」，用下一节 GitHub Actions 备选（免费）或 UptimeRobot 付费版，二者取一即可，不必都上。

**怎么看告警：**

- UptimeRobot 判定 Down → 发邮件 → **先打开线上面板链接**（打开动作本身就是一次冷启动唤醒），再看 `/api/push-log`（本地副本带 `?token=` 查线上，或直接看面板）确认当天推送是否补齐。
- 若 5 分钟内自动恢复为 Up：说明只是容器被回收后冷启动，**无实际损失**，忽略即可。
- 若长时间 Down：按第 5 节排查。

---

## 4. 备选方案：GitHub Actions（免费，判据更严）

**前提声明（重要，做不到就不要配）：**
1. 需要有一个 **GitHub 仓库**。当前项目只推到 Gitee；Gitee 没有等价的免费定时流水线能力，所以备选落在 GitHub。
2. ⛔ **不必把业务代码推上 GitHub**——新建一个只放本工作流的独立小仓库即可（公开私有都行，私有仓库同样有每月 2000 分钟免费额度）。
3. GitHub 对** 60 天无提交的仓库会停用定时工作流**；`schedule` 触发在高峰时段可能**延迟数分钟**。这两点是它只能当备选的原因。
4. 配好后用 **Actions 页 → 左侧 `uptime` → `Run workflow`** 手动触发一次验证（不必等 cron）。

**工作流内容（存为 `.github/workflows/uptime.yml`）：**

```yaml
name: uptime
on:
  schedule:
    # GitHub cron 用 UTC。北京 = UTC+8。只盯关键窗口，省免费额度：
    - cron: '*/5 1-2 * * 1-5'    # 北京 09:00-10:59  竞价 + 早盘
    - cron: '*/5 6-8 * * 1-5'    # 北京 14:00-16:59  收盘 + 15:30 推送窗
    - cron: '*/5 12-14 * * 1-5'  # 北京 20:00-22:59  晚间新闻 + 次日计划
  workflow_dispatch: {}          # 手动触发（配好后先点这个验证）
jobs:
  ping:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: ping /api/lock/status
        id: probe
        run: |
          URL='https://quant-dashboard-77614.app.workbuddy.host/api/lock/status'
          code=$(curl -s -o /tmp/body.json -w '%{http_code}' --max-time 20 "$URL")
          echo "http=$code"
          echo "body=$(head -c 300 /tmp/body.json)"
          if [ "$code" != "200" ]; then
            echo "::error::uptime 探活失败：HTTP $code"; exit 1
          fi
          node -e '
            const b = JSON.parse(require("fs").readFileSync("/tmp/body.json","utf8"));
            if (typeof b.appVer !== "string" || b.pushRole !== "primary") {
              console.error("返回体不符合预期：", JSON.stringify(b).slice(0,200));
              process.exit(1);
            }
            console.log("OK appVer=" + b.appVer);
          '
      # 可选：失败时推飞书（任选其一；需要先在仓库 Settings → Secrets 里加 FEISHU_WEBHOOK）
      # 注意：若机器人开了「签名校验」，这一步会失败，先关掉签名或删掉本步
      - name: 失败时飞书告警
        if: failure()
        env:
          HOOK: ${{ secrets.FEISHU_WEBHOOK }}
        run: |
          [ -z "$HOOK" ] && { echo "未配 FEISHU_WEBHOOK，跳过"; exit 0; }
          curl -s --max-time 15 -X POST "$HOOK" \
            -H 'Content-Type: application/json' \
            -d '{"msg_type":"text","content":{"text":"[uptime] 量化看盘主实例探活失败，请打开线上面板唤醒并检查推送：" "https://quant-dashboard-77614.app.workbuddy.host"}}'
```

**月度成本核算：** 每天 3 个窗口共 8 小时 × 12 次 = 96 次运行，每次约 40 秒（含 runner 启动），≈64 分钟/天；按每月 21 个交易日 ≈ **1340 分钟**，在免费 2000 分钟内。

---

## 5. 告警含义与处置

| 现象 | 最可能原因 | 处置 |
| --- | --- | --- |
| 短暂 Down 后自动 Up | 托管平台回收空闲容器，下一次请求（探针本身）触发冷启动 | 无需处理；确认当天推送记录后忽略 |
| 交易日关键窗口 Down（09:15-09:30 / 15:30 / 21:00 附近） | 容器在**应发时刻**不在线 | 打开线上面板唤醒 → 检查 `/api/push-log` 该时刻是否有记录 → 缺推的看是否触发补发逻辑（hg 轮起有迟到宽容窗口，别手动重发造成重复） |
| 持续 Down（>30 分钟） | 平台侧故障 / 发布把服务发挂了 | 看最近一次发布时间线；必要时用本地副本顶上看盘，修好后重新发布 |
| 本地副本（8787）也应同时监控 | 用户电脑休眠时副本保活链断裂 | UptimeRobot 免费额度充裕，可加第二个 Monitor：`http://<本机地址>:8787/api/lock/status`（内网地址需与 UptimeRobot 网络可达，通常不可达 → 这条仅作可选，别为它花钱） |

⛔ **处置纪律：线上 pushlog 判「证据丢了没」要用启动时刻快照**——容器一天回收多次，pushlog 会清零，别把「记录为空」直接当成「一条没发」（详见长期记忆 §4）。

---

## 6. 局限与风险声明（诚实地写在这）

1. **5 分钟粒度 ≠ 实时。** 一次「回收→恰好错过 15:30 推送→5 分钟后被探针唤醒」的组合，监控只能事后告诉你，不能阻止。
2. **UptimeRobot 是境外 SaaS。** 它探的是公网 URL，本身不接触业务数据；但如果你在意「线上地址被第三方定期访问」这个事实，请注意这一点（返回体无敏感字段，已核）。
3. **GitHub cron 会延迟。** 高峰时段延迟几分钟是常态，所以判据严的它也只能当备选、不能当唯一。
4. **本方案不覆盖「进程活着但推送通道坏了」**（例如飞书机器人密钥失效）。那属于推送链路健康，方向不同：每日自检里已有 `feishuSecReady` 状态字段（线上 `/api/state`），下一步可做「每日自检带通道状态」，不在本方案范围。
5. **未验证假设**：托管平台的回收阈值行为（「多久无请求会被回收」）没有官方数字，以上窗口时长按实测保守估计；若实测唤醒频率高于预期，可把副本保活间隔从 3 分钟再压缩。

---

## 7. 上线后自检清单

- [ ] UptimeRobot 监控状态为 **Up**，邮箱能收到测试告警（UptimeRobot 有 "Send Test Alert"）。
- [ ] （可选）GitHub 仓库 `Run workflow` 手动跑通，日志里看到 `OK appVer=...`。
- [ ] 在日历 / 待办里记一条：**每次发布后无需改监控配置**（URL 不变、判据不含 appVer）。
- [ ] 下次容器被回收时，回看 UptimeRobot 历史曲线，确认「Down→自动 Up」的时长符合预期（<10 分钟）。
