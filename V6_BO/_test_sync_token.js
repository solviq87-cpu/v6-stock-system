// 守门测试：「本机 → 线上」转发令牌（config.json 的 syncUpstream.token）不能烂在暗处。
// 2026-10-05 实测：本地 config.json 里躺着一枚早已作废的令牌，server.log 里
// 41 条 `[sync↑] 线上拒绝了 /api/holdings · xxx →`（错误原因为空 = 被口令闸门拦）。
// 后果是用户在电脑面板上改持仓、改配置，手机上永远看不到，而且**不报错不弹窗**，纯静默失败。
// 根因：--restore 会把 config.json 还原成发版前备份（旧令牌），而发版过程 bump 世代号 → 旧令牌作废。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const pub = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');
const post = fs.readFileSync(path.join(ROOT, '_post_publish.py'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// 1) _publish.py 必须有 refresh_sync_token，且 --restore 里真的调了它
//    （只定义不调用 = 注释里许愿，等于没修）
ok('_publish.py 定义了 refresh_sync_token',
  /def refresh_sync_token\(cfgp\)/.test(pub));
ok('restore_local() 里调用了 refresh_sync_token（--restore 兜底重签）',
  /def restore_local\(\)[\s\S]*?refresh_sync_token\(cfgp\)/.test(pub));

// 2) 必须是 deviceToken（92 位），短令牌（48 位）写进去同样会静默失败
ok('拒绝写入短令牌（<80 位就放弃）',
  /if len\(tok\) < 80:/.test(pub) && /已放弃写入/.test(pub));

// 3) 签完必须验真 —— 不验的话"签了但线上不认"照样烂在暗处（本次就是这么烂的）
ok('签完用线上接口验真后才写入',
  /probe = post\("\/api\/holdings"[\s\S]{0,200}?if probe\.get\("locked"\) or probe\.get\("needPassword"\)/.test(pub));
ok('验真用 __probe_noop__（不写数据、不触发推送）',
  /"action": "__probe_noop__"/.test(pub));

// 4) 写入内容：enabled + url + token 三件套，且强制 pushRole=replica
ok('写入 enabled/url/token 三件套',
  /su\["enabled"\] = True/.test(pub) && /su\["url"\] = ONLINE/.test(pub) && /su\["token"\] = tok/.test(pub));
ok('写入时强制 pushRole=replica（绝不和线上抢推送）',
  /cfg\["pushRole"\] = "replica"/.test(pub));

// 5) 失败要大声，不能静默吞掉
ok('重签失败会打印警告而非静默',
  /⚠️ 转发令牌重签失败/.test(pub) && /⚠️ 转发令牌重签异常/.test(pub));

// 6) 台账卫生：同 fp 只留最新一条，别每次发版往用户台账堆一行
ok('重签后清理同 fp 的旧设备记录',
  /FPUB_SYNC02[\s\S]{0,600}?\/api\/lock\/revoke/.test(pub));

// 7) _post_publish.py 那一道也还在（双重保险，顺序谁先谁后都不怕）
ok('_post_publish.py 仍写 syncUpstream.token',
  /su\["token"\] = tok/.test(post) && /su\["enabled"\] = True/.test(post));
ok('_post_publish.py 同样拒绝短令牌',
  /if len\(tok\) < 80:/.test(post));

// 8) 当前本机 config.json 里的令牌必须够长（不验网络，只查形态）
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const su = cfg.syncUpstream || {};
  ok('config.json.pushRole = replica', cfg.pushRole === 'replica');
  ok('config.json.syncUpstream.enabled = true', su.enabled === true);
  ok('config.json.syncUpstream.token 为长令牌（>=80 位，实测 %d 位）'.replace('%d', String((su.token || '').length)),
    (su.token || '').length >= 80);
  ok('config.json.syncUpstream.url 指向线上实例', /quant-dashboard/.test(su.url || ''));
} catch (e) {
  ok('能读到本地 config.json', false);
}

console.log('\n转发令牌守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
