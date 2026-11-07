// 云服务客户端 · pushlog 持久化
// 用途：把「今天发没发过」的唯一证据从本地文件/内存迁移到云端 PostgreSQL，
//      解决线上容器回收后 pushlog 清零 → sentToday/pushedToday 失效 → 重复推/漏推的问题。
//
// 设计原则：
// 1. 云端写入是「异步、不阻塞、失败静默降级」——推送主路径不能因为云慢而卡死。
// 2. 本地 PUSH_LOG 内存数组仍是权威查询源；云端只是跨容器持久化备份。
// 3. 启动时从云端批量拉回最近 N 天记录，合并进内存。
// 4. 云端表 RLS 允许 anon 追加写入、公开读取；不开放 update/delete，防止篡改历史。

// 本地运行无需云端 SDK；只有实际启用云备份时才加载。
// 云端依赖未安装时，由下方调用者的 try/catch 安全降级。
function createWorkBuddyCloud(config) {
  const sdk = require('@tencent-ai/workbuddy-cloud-sdk');
  return sdk.createWorkBuddyCloud(config);
}

const PUBLIC_CONFIG = {
  endpoint: process.env.V6_CLOUD_BACKUP_ENDPOINT || '',
  oauthRelayBaseUrl: process.env.V6_CLOUD_BACKUP_OAUTH_URL || '',
  publishableKey: process.env.V6_CLOUD_BACKUP_PUBLIC_KEY || ''
};

let _cloud = null;
function getCloud() {
  if (!PUBLIC_CONFIG.endpoint || !PUBLIC_CONFIG.oauthRelayBaseUrl || !PUBLIC_CONFIG.publishableKey) throw Error('云备份未配置，保留本地日志');
  if (!_cloud) {
    _cloud = createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
  }
  return _cloud;
}

function dayKeyOf(ts) {
  const d = new Date(Number(ts) || 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 单条记录从内存格式 → 云端表格式
function toCloudRow(rec) {
  return {
    ds: rec.ds || dayKeyOf(rec.ts),
    ts: Number(rec.ts) || 0,
    status: String(rec.status || ''),
    title: String(rec.title || ''),
    text: rec.text == null ? null : String(rec.text),
    channel: rec.channel == null ? null : String(rec.channel),
    note: rec.note == null ? null : String(rec.note),
    extra: rec.extra && typeof rec.extra === 'object' ? rec.extra : null
  };
}

// 云端表格式 → 内存格式
function fromCloudRow(r) {
  const rec = {
    time: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : new Date(Number(r.ts)).toLocaleString('zh-CN'),
    ts: Number(r.ts),
    status: r.status,
    title: r.title
  };
  if (r.text != null) rec.text = r.text;
  if (r.channel != null) rec.channel = r.channel;
  if (r.note != null) rec.note = r.note;
  if (r.extra != null) rec.extra = r.extra;
  return rec;
}

// 异步写入云端（不阻塞、失败降级）
async function savePushLogToCloud(rec) {
  try {
    const { error } = await getCloud().database.from('pushlog').insert(toCloudRow(rec));
    if (error) console.error('[cloud-pushlog] 写入失败:', error.message || error);
    else console.log('[cloud-pushlog] 写入成功:', rec.title);
  } catch (e) {
    console.error('[cloud-pushlog] 写入异常（已降级到本地）:', e && e.message);
  }
}

// 启动时从云端拉回最近 N 天记录
async function loadPushLogFromCloud(days = 14) {
  try {
    const cutoff = Date.now() - (Number(days) || 14) * 86400000;
    const { data, error } = await getCloud().database
      .from('pushlog')
      .select('*')
      .gte('ts', cutoff)
      .order('ts', { ascending: false })
      .limit(5000);
    if (error) {
      console.error('[cloud-pushlog] 加载失败:', error.message || error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    console.log('[cloud-pushlog] 从云端加载 ' + data.length + ' 条记录');
    return data.map(fromCloudRow);
  } catch (e) {
    console.error('[cloud-pushlog] 加载异常（已降级到本地）:', e && e.message);
    return [];
  }
}

// 把内存 PUSH_LOG 批量同步到云端（用于发布前/定时同步）
async function syncPushLogToCloud(records) {
  if (!Array.isArray(records) || !records.length) return;
  try {
    const rows = records.map(toCloudRow);
    // upsert 依据表上的 UNIQUE(ds, ts, status, title) 约束
    const { error } = await getCloud().database.from('pushlog').upsert(rows, { onConflict: 'ds,ts,status,title' });
    if (error) console.error('[cloud-pushlog] 批量同步失败:', error.message || error);
  } catch (e) {
    console.error('[cloud-pushlog] 批量同步异常:', e && e.message);
  }
}

module.exports = {
  getCloud,
  savePushLogToCloud,
  loadPushLogFromCloud,
  syncPushLogToCloud,
  PUBLIC_CONFIG
};
