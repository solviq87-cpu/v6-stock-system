"use strict";
// ============================================================
// 💾 数据自动备份 _backup_data.js（2026-10-28）
// 每日把关键运行时数据（不入git的那些）备份到工件目录。
// 代码不用备份（git仓库有），这些文件丢了仓库里没有。
// ============================================================
const fs = require("fs");
const path = require("path");

const ROOT = "C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard";
const BACKUP_DIR = "C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard-artifacts\\数据备份";

// 关键数据文件（access/config/模拟盘/学习库/行业库/推送流水）
const DATA_FILES = [
  "access.json", "config.json", "paper.json", "holdings.json",
  "learnall.json", "learn_history.json", "learn_pushed_outcomes.json",
  "learn_missed_seals.json", "stats.json", "stock_industry.json",
  "pushlog.json", "auction_snapshot.json", "strategy_cards.json",
  ".holdings_ops.json", ".holdings_pull_history.json"
];

// 用户定调（2026-10-28）：每周一备份一次即可；备份覆盖式——只保留最新一份，
// 旧的整目录删掉重建，不留历史版本（用户担心占磁盘；这些文件变化慢，周粒度足够回滚）。
function main() {
  const dir = path.join(BACKUP_DIR, "latest");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(dir, { recursive: true });

  let ok = 0, miss = 0;
  for (const f of DATA_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) { miss++; continue; }
    try {
      fs.copyFileSync(src, path.join(dir, f));
      ok++;
    } catch (e) {
      console.error("备份失败 " + f + ":", e.message);
    }
  }
  const t = new Date();
  const stamp = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  try { fs.writeFileSync(path.join(dir, "_备份时间.txt"), `上次备份：${stamp}\n覆盖式：每次运行整目录重建，只保留这一份。`, "utf8"); } catch (_) {}
  console.log(`[数据备份·覆盖式] ${stamp}：成功 ${ok} 个，源缺失 ${miss} 个 → ${dir}`);
}

// ⛔ 2026-10-28：加 require.main 闸（同 _clean_devices.js 事故族）——发版前「require 全部模块」巡检
// 会裸 require 本文件，不闸就每次巡检都触发一次覆盖式备份。
if (require.main === module) main();
