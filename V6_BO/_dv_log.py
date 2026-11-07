# -*- coding: utf-8 -*-
# dv 轮日志：写入两个工作区的 2026-10-08.md（不存在则创建，存在则追加）
import io, os

DIRS = [
    r"C:\Users\28957\WorkBuddy\2026-09-25-20-57-21\.workbuddy\memory",
    r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\.workbuddy\memory",
]

ENTRY = u"""

## dv 轮（20261007dv，已发布）—— 代码里那些静默跳过，跳过时有没有留下为什么

**角度**：全项目 `continue` / 裸 return / 空 catch，跳过时不计数、不留痕、不告警的位置有多少；
跳过的原因有没有交出去、被跳过的那一支有没有被算进分母、同类跳过在不同函数里是不是同一个判据。

### 侦察实证（`_scan_dv.js` / `_scan_dv2.js`）
- 全项目 **160 处 `continue`**，其中 **145 处完全静默**（不计数、不留痕、不告警）；50 处裸 return（39 静默）；77 处空 catch。
- **实证一 · 命中率的分母不明**：用真实 stats.json 实测 —— 样本库 **1959 条只有 368 条（18.8%）**进得了实测命中率档：
  缺次日口径 737／缺概率 242／历史回测 600／事后 12。更严重的是 `histzt`(600)／`pool`(311)／`trend`(101)／`zt`(39)
  四类共 **1051 条整类零存活** —— 面板上这些类型的实测栏永远是空的，谁也分不清「还没回验」还是「按设计被排除」，
  只会以为是样本没积累够而干等。
- **实证二 · paperBuy 五处 continue 静默**：面板只说「暂无持仓（等待新信号）」，真实原因可能是五只候选全因
  一字板买不进、或现金不足一手，用户无从自查。

### 改法（唯一出口 + 登记表）
- 新增 `SKIP_RULE`（27 种跳过原因）+ `_skipTally` + `skipAdd` / `skipWhy` / `skipTop` / `skipState`。
  ⛔ **未登记的 kind 直接丢弃**（`if (!SKIP_RULE[k]) return 0`）—— 逼着新增跳过点先来这里写清原因。
- `empTable` 两处 continue 拆成五条分别计数（`empNoNd` / `empVoid` / `empNoProb` / `empBacktest` / `empPostHoc`），
  交出 `empSkipStat()`（样本存活率 + 排除原因榜 + note 文案）。
- `paperBuy` 五处（buyHeld/buyNoPrice/buySealed/buyNoCash/buyOverCash）、`scanZtPre` 八处、`scanTrendUniverse` 九处全部按原因计数。
- `/api/state` 下发 `skipStat` 与 `empSkip`；前端学习表补「样本存活」与「跳过台账」两行，并明说
  「排除项按设计不参与实测标定，不是数据丢失」。

### 守门
- 新增 `_test_skip_trace.js`（31 断言 / 0 失败，A~F 六组：登记表、empTable 五分支真跑、
  paperBuy 五处、两个扫描器 8/8 与 9/9、接线、真实样本库回归 1959→368）。已进 CODE_FILES。
- 全量回归 **4477 断言 / 0 失败 / 146 套件**。

### 本轮踩到的坑（8 条红灯，全是「守门钉死旧字面量」+ 1 个沙箱漏注入）
1. `_test_empcalib` `ReferenceError: skipAdd is not defined` —— **第 24 次**沙箱漏注入（empTable 新增了 skipAdd 调用）。
2. `_test_hindsight` 钉死 `if (!isLiveSample(s)) continue;` —— dv 把它拆成两条分别计数的分支。改判据钉语义
   （两类都必须有紧接 continue 的出局分支）。⛔ 反证的 `replace` 必须**连 `if (...)` 一起吃**，
   只删后半段会留下悬空的 `if (cond) }` → SyntaxError（第一次修完就踩了）。
3. `_test_paper_money` 取块结束标记钉死 `if (cost + fee > acc.cash) continue;` —— 现在多了 skipAdd。
   顺带发现沙箱里 `SRC_BUDGET` 也会走到 `skipAdd` → 补空实现。
4. `_test_trend_gate_parity` 钉死 `...jumpy) continue;` —— 改钉「判定式后 80 字符内必须出现 continue」。
5. `_test_data_cap` E4 反证**跨天失效**：测试数据用 `now - i*60000`（499 分钟前），
   北京时间 00:29 跑时会落到昨天 → 判据反而返回 true、反证静默失效。改成锚定「今天零点 + i」。

### 线上核验（发版后）
- `/api/lock/status` → `appVer=20261007dv`、`pushRole=primary`。
- `/api/state` 带 token → `skipStat.total=11622`，top 榜 8 项全带中文原因；`empSkip` = 1959→367（存活 19%）。
- `/api/holdings` 带 token → **0 条**（未还原，符合铁律）。

### 教训
**跳过不是免费的** —— 每条 `continue` 都在改结论的分母。只说「跳过了 N 条」没有意义，
必须说清是哪道判据跳的、跳了多少；**「按设计排除」与「还没回验」必须分开说**，否则用户只会干等。
另：构造「今天」的测试数据不许用「now 往前推 N 分钟」（凌晨会跨天）。
"""

for d in DIRS:
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    p = os.path.join(d, '2026-10-08.md')
    with io.open(p, 'a', encoding='utf-8', newline='\n') as f:
        f.write(ENTRY)
    with io.open(p, 'r', encoding='utf-8') as f:
        s = f.read()
    print('APPENDED %s  %d bytes  CR=%d' % (p, os.path.getsize(p), s.count('\r')))
print('done')
