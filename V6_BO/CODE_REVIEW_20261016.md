# 严格代码审查报告（批判性视角，非本人编写假设）

- 审查对象：`stock-dashboard`（根 `C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard`）
- 生产核心文件：`server.js`（~1.7 万行）、`public/index.html`、`em.js`、`analysis.js`、`holdings.js`、`learnall.js`、`ztpre.js`、`feishuq.js`、`nextplan.js`
- 审查方式：自动化（语法、`node --check` 全量 431 个 .js；守门套件 `_runall.js` 全量 226 套件）+ 针对历史故障模式的静态扫描 + 关键安全路径人工读码 + **线上无 token 实测**
- 结论基调：**未发现可被利用的“严重”漏洞**；下列按严重程度排序，均为可改进/需验证项，未改动任何代码。

---

## 一、严重（Critical）—— 当前无可利用项

经线上实测 + 代码核对，**未发现严重漏洞**。唯一“理论严重”项（见 HIGH-1）已在当前托管拓扑下验证为安全。

---

## 二、高危（High，条件性/部署依赖）

### H1. `isLocalReq` 把“socket 对端是 127.0.0.1”直接判为开发者（edit），存在因托管拓扑变化而整站鉴权绕过的隐患
- **位置**：`server.js:14296-14313`（`isLocalReq`）+ `14272`（`isEditorReq` 对本机恒等 edit）。
- **逻辑漏洞**：本机直连免密是设计需要，但判据只有 `req.socket.remoteAddress` 是否回环。若托管反向代理以 **loopback（127.0.0.1）** 把公网流量转发给 Node 进程，则所有公网请求都会被 `isLocalReq` 判为本机 → 直接获得 edit 权限 → 设备锁闸门（14363）、`requireEditor`、源码导出、改配置全部失效。
- **实测结果（关键）**：当前云端部署下，对 `https://quant-dashboard-77614.app.workbuddy.host` 的无 token 访问 `/api/source-all`、`/api/sync/export`、`/api/state` **均返回 `{"locked":true,"needPassword":true,...}`**，说明当前托管代理并非以 loopback 连接 Node（remoteAddress 为非回环地址），**当前不可利用**。
- **复现方法**：取决于托管拓扑。若未来部署改为“代理→127.0.0.1→Node”，则任意公网客户端无需口令即可读源码、导出业务数据、改配置。
- **修复建议**：
  1. 增加显式云端标志（如 `QD_CLOUD=1`），置位时 `isLocalReq` 对“非本机真实控制台”一律不豁免；
  2. 或把 `isLocalReq` 的回环豁免限定为“既回环且 Host 为本地控制台域名”并**额外排除已知的平台代理来源 IP**；
  3. 加一道启动自检：进程启动时探测自身是否处于代理后，若是则强制关闭回环免密。
- **风险点/未验证假设**：结论依赖“当前托管代理非 loopback 连接”这一观察；拓扑一旦变化即失效，属于“隐性地雷”而非“当前 bug”。

---

## 三、中危（Medium）

### M1. 守门套件长期存在 10 个“永久红灯”（8 代码 + 2 环境），掩盖真实回归
- **证据**：`_runall.js` 全量 226 套件 = 通过断言 **6409** / 失败断言 **20**；红灯套件：
  `auth_matrix / datasource_fallback / datekey / learn / paper_reconcile / prevsnap / return_contract / sort_slice`（8 个代码红）+ `otp / otp2`（2 个环境红，因本机未绑找回手机号，重置短信流整段跳过）。
- **逻辑/质量漏洞**：把“已知会红”当作基线接受，等于让守门套件失去“红=回归”的语义——任何**新引入的真 bug** 都会淹没在这 20 条噪声里。其中 `datekey`（交易日边界）、`paper_reconcile`（持仓对账）、`return_contract`、`sort_slice` 完全可能是**真实的潜在缺陷**，只是被长期标“基线”而无人复核。
- **复现方法**：`node _runall.js` → 观察失败清单与基线是否一致。
- **修复建议**：
  1. 逐个 triage：真 bug 就修；断言已过时/口径错的就改断言或删除；环境依赖的就标记为 `skip`（显式跳过并写原因），不要静默计入“基线红”；
  2. 目标：要么 0 红，要么有一份**带理由的显式 allowlist**，且 `_runall` 的“新增红”数必须严格为 0 才能算通过。
- **风险点**：`otp/otp2` 两个环境红意味着“手机号找回密码”这条**安全敏感恢复路径在此环境零覆盖**，而代码注释（14003）明确提到过“验证码轰炸”历史——未测的恢复路径可能藏 bug。

### M2. `sectorInflow: sec ? sec.mainInflow : 0` 把“板块缺失”冒充成“0 净流入”
- **位置**：`server.js:11253 / 11256`（涨停池/复盘条目构造）。
- **逻辑漏洞 / 数据可信度**：当 `sec`（板块对象）查不到时，`sectorInflow` 兜底为 `0`。这与同函数内 `mainPct: snap && snap.mainPct ? snap.mainPct : null`（11249，**缺失用 null**）自相矛盾，也违背本项目自身铁律“资金流缺失降级显式声明（⛔ 不拿 0 冒充）”（hj 轮）。结果：前端把“查不到板块”和“板块真实净流入为 0”显示成一模一样，用户以为“有数据 = 0”，实际是“没数据”。
- **复现方法**：让某只涨停股的板块未能在 `S.sectors` 中解析（如板块名归一失败），触发复盘/涨停池；观察该条 `sectorInflow` 显示为 `0` 且无“缺失”提示。
- **修复建议**：`sec` 缺失时返回 `null`（或显式 `undefined`），前端对 `null` 渲染“板块数据缺失”而非“0”；与 `mainPct` 保持一致口径。
- **风险点/未验证假设**：实际触发频率取决于板块归一成功率，未实测；但**口径不一致本身是确定的设计缺陷**。

---

## 四、低危（Low，工程卫生 / 边缘）

### L1. 两份完整 server 备份 `_bak_server_dg.js` / `_bak_server_dh.js` 躺在受服务根目录
- **证据**：`grep -L` 全仓无任何 `require('./_bak_server_...')`；`/api/source-all` 实测 5.4MB 源码包含这俩（各近万行）。
- **问题**：① 受服务根目录的死代码，膨胀“复制所有源码”产物；② 若 `_publish.py` 同步盲目复制根目录，会随包发布（浪费且可能误导）；③ 旧快照易在未来改动时被误读。
- **复现方法**：`ls -la _bak_server_*.js` 确认存在且无引用。
- **修复建议**：移出受服务根目录（如 `backups/` 或 `.bak/`），或确认无用后删除；发布同步清单显式排除。

### L2. `/api/stream`（SSE）无单 IP/单令牌并发连接上限
- **现状（已核对，非 bug）**：SSE 受设备锁闸门保护（14363）——无 token 远程请求在到达 15299 前已被 `return {locked:true}`，实测确实如此；且 view 角色只收到公开事件（`sseSend`），私密数据走 `sseSendEdit`（`SSE_EDIT`）。所以**无鉴权绕过、无私密泄露**。
- **防御纵深建议**：持有效 view 令牌者理论上可开大量 SSE 连接耗尽 FD/内存。建议对每 token/IP 限制并发 SSE 数。
- **复现方法**：持有效令牌 `for i in ...; do curl -N <host>/api/stream & done`，观察连接数。
- **严重性**：低（需有效令牌，且 `authThrottle` 已限制令牌爆破）。

### L3. 全仓约 80 处空 `catch {}`，需逐一定性
- **现状**：多数属良性（corrupt 文件清理 613/623/632、流式 `res.on('data')` 8603、kline 回拉 14898/14911/14951/15020 显式“拉不到静默沿用本地”）。但存在个别“静默吞错”值得标记：
  - `server.js:14386`（`/api/client-error`）`JSON.parse(body||'{}')` 失败 → `b={}` → 因 `msg||stack` 为假直接忽略，畸形错误上报被静默丢弃（可接受，但无日志）。
  - `server.js:8605`（飞书回包）解析失败 → `j=null` → 正确返回 `ok:false`（已正确处理，非静默）。
- **历史同源教训**：hi 轮“空 catch 吞 TDZ ReferenceError 致 PUSH_LOG 每次启动为空”曾发生在守门套件源串里（已修）。当前生产路径未见同类。
- **修复建议**：对数据路径上的空 catch 至少 `console.warn` 一次，便于将来自查；不要在“本应失败即中止”的分支静默继续。

### L4. 数值 `x || 0` 与 `null` 口径混用
- **证据**：`server.js:11242-11248` 等用 `z.floatCap || 0`、`z.amount || 0`；而 11249 用 `null`。对“0 是合法值”的字段 `|| 0` 无碍，但项目应在“缺失 vs 零值”上统一，避免将来在关键字段把“缺失”误显为“0”。
- **修复建议**：仅在字段 0 为合法语义时用 `|| 0`；缺失语义一律 `null`。

### L5. 双实例共享文件写的理论竞态
- **现状**：primary（云端）与 replica（本机 8787）分属不同文件系统，各自定时器写各自文件，经 `syncUpstream` 单向拉取，无跨实例并发写同一文件。当前不可利用。
- **边缘**：若将来两个实例指向同一数据目录，read-modify-write 定时器可能交错写 JSON 致损坏。
- **修复建议**：共享目录场景需加文件锁或合并写者。

---

## 五、已验证安全（明确列出，避免过度告警）

- **语法**：`node --check` 全量 431 个 `.js` → **0 错误**。
- **CRLF**：仅 `_test_no_plaintext_pwd.js` 一个测试文件有 77 处，生产文件干净。
- **注入**：`server.js` 无 `eval` / `new Function` / `child_process.exec` / `setTimeout(字符串)`；无命令注入面。
- **路径穿越**：`/api/source`（GET/POST）走 `EDITABLE_SRC` 白名单（16169/16177），写前备份 + `vm.Script` 语法校验 + `atomicWrite`；`/api/source-all` 仅 `readdirSync` 根目录 `.js`（无用户路径输入）。
- **凭据泄露**：`/api/sync/export` 仅返回密码哈希/盐/设备台账（`accessAuth`），**绝不返回明文**；`console.*` 未打印 token/密码/机器密钥（仅 7923 一条“凭据打码”安全告警）。
- **请求体 DoS**：`BODY_LIMIT`（8MB）已在 13553-13577 强制，超限返回 413 且不执行。
- **本机判据抗伪造**：`isLocalReq` 完全不采信 `x-forwarded-for`/`x-real-ip` 等客户端可控头，并带 DNS 重绑定 Host 校验（14307-14311）。
- **令牌模型**：`roleOf` 正确处理过期/撤销/自证设备令牌；设备锁闸门线上实测生效（无 token → `locked:true`）。
- **SSE 私密隔离**：view 角色仅收公开事件；持仓/推送流水等私密走 `sseSendEdit`（edit-only）。
- **环境变量**：`process.env` 仅用于端口/Host/公网 URL/机器密钥覆盖等配置注入，不含硬编码密钥（密钥存 `config.json`/`access.json`/机器密钥文件）。
- **无重复实现（生产路径）**：`isLimitUp`/`buildZTReason`/`requireEditor`/`themeKeyOf`/`themeStrengthOf` 在活动代码各仅一份（重复仅存在于 `_bak_server_*` 备份）。

---

## 六、给下一轮的执行优先级建议（仅建议，未改动代码）

1. **先排 H1**：确认云端是否有办法强制关闭回环免密（加 `QD_CLOUD` 或代理来源 IP 白名单），消除“拓扑一变即裸奔”的隐患。
2. **M1 triage**：把 10 个永久红逐个定性，至少把 `datekey/paper_reconcile/return_contract/sort_slice` 的真伪查清楚；恢复守门“红=回归”的语义。
3. **M2 改口径**：`sectorInflow` 缺失用 `null`，与 `mainPct` 对齐——直接关系“每个数字可信”这条北极星。
4. **L1 清理**：备份文件移出受服务根目录（顺带减小源码包体积、避免误部署）。
5. **L3 加日志**：数据路径空 catch 至少留一条 warn。

> 报告原则（按批判性宪章）：以上结论区分【事实】（线上实测、grep/语法结果）与【预测/观点】（H1 条件性、M2 触发频率）。未验证假设已逐条标注。未改动任何代码。
