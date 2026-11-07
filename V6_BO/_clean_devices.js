// 设备台账清理脚本（hz 轮）
// 用户「一台电脑一部手机」，清理除实际设备外的所有历史记录
const fs = require('fs');
const ACCESS_FILE = 'access.json';
const BAK_DIR = '.device_cleanup_bak';

function load() { return JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8')); }
function save(d) { fs.writeFileSync(ACCESS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

// ⛔ 2026-10-28 自治修复：裸 require 会立即删设备台账（发版前「require 全部模块」巡检误触发，
// 27 条历史 token 被当场清掉）。加 require.main 闸：只有直接 `node _clean_devices.js` 才执行。
function main() {
// 备份
if (!fs.existsSync(BAK_DIR)) fs.mkdirSync(BAK_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(ACCESS_FILE, `${BAK_DIR}/access_pre_cleanup_${ts}.json`);

const d = load();
const devs = d.devices || {};
const viewDevs = (d.view && d.view.devices) || {};
const revoked = d.revoked || {};

// 保留策略：edit = 最新 Windows + 最新 iPhone + FPUBLISH01
const keepEdit = new Set();
const winKeys = Object.keys(devs).filter(k => (devs[k].name || '').startsWith('Windows'));
const latestWin = winKeys.sort((a, b) => (devs[b].ts || 0) - (devs[a].ts || 0))[0];
if (latestWin) keepEdit.add(latestWin);

const iphoneEditKeys = Object.keys(devs).filter(k => (devs[k].name || '').includes('iPhone'));
const latestIphoneEdit = iphoneEditKeys.sort((a, b) => (devs[b].ts || 0) - (devs[a].ts || 0))[0];
if (latestIphoneEdit) keepEdit.add(latestIphoneEdit);

const pubKeys = Object.keys(devs).filter(k => (devs[k].fp || '') === 'FPUBLISH01');
const latestPub = pubKeys.sort((a, b) => (devs[b].ts || 0) - (devs[a].ts || 0))[0];
if (latestPub) keepEdit.add(latestPub);

// view = 最新一条（同手机 fp 重复只留最新）
const keepView = new Set();
const viewKeys = Object.keys(viewDevs);
const latestView = viewKeys.sort((a, b) => (viewDevs[b].ts || 0) - (viewDevs[a].ts || 0))[0];
if (latestView) keepView.add(latestView);

let removedEdit = 0, removedView = 0;

// 执行删除
for (const k of Object.keys(devs)) {
  if (!keepEdit.has(k)) {
    const v = devs[k];
    delete devs[k];
    if (!revoked[k]) revoked[k] = Date.now();
    removedEdit++;
    console.log(`[edit] 删除: ${v.name || '?'} ${v.fp || ''}`);
  }
}

for (const k of Object.keys(viewDevs)) {
  if (!keepView.has(k)) {
    const v = viewDevs[k];
    delete viewDevs[k];
    if (!revoked[k]) revoked[k] = Date.now();
    removedView++;
    console.log(`[view] 删除: ${v.name || '?'} ${v.fp || ''}`);
  }
}

d.revoked = revoked;
save(d);

console.log(`\n清理完成: edit ${removedEdit} 条删除, 保留 ${keepEdit.size} 条`);
console.log(`           view ${removedView} 条删除, 保留 ${keepView.size} 条`);
console.log(`           revoked 新增 ${removedEdit + removedView} 条`);
console.log(`备份: ${BAK_DIR}/access_pre_cleanup_${ts}.json`);
} // main()

if (require.main === module) main();
