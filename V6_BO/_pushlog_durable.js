// ④ 本地耐久化（用户「先连本地看看效果再决定」）：
// pushlog / marketBeta 每次 flush 镜像到本地 durable/ 目录；启动时把 durable 副本合并回内存，
// 按 ts+标题+状态 去重，恢复被 500 容量上限裁掉的早期证据。
// 本地副本在用户机器磁盘上随进程重启/回收存活——先在 localhost:8787 验证，再决定是否上云。
// 依赖注入/纯函数化，便于守门测试 mock 跑；server.js 用真 fs 跑。

function pushLogKey(r) {
  return (Number(r && r.ts) || 0) + '|' + (r && r.title ? String(r.title) : '') + '|' + (r && r.status ? String(r.status) : '');
}

// 合并两份流水：去重 + 按 ts 倒序 + 裁到 cap。existing=内存当前，incoming=durable 副本。
function mergePushLogs(existing, incoming, cap) {
  const seen = new Set();
  const out = [];
  const all = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  for (const r of all) {
    const k = pushLogKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  out.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  const c = typeof cap === 'number' ? cap : 500;
  if (out.length > c) out.length = c;
  return out;
}

module.exports = { pushLogKey, mergePushLogs };
