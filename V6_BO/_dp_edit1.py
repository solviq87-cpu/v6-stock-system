# -*- coding: utf-8 -*-
# dp 轮改码 第 1 步：NUM_NEUTRAL 增加 gap 项 + 新增 numGap() 唯一出口
import io, sys

P = 'server.js'
s = io.open(P, encoding='utf-8').read()

OLD = """  turnover:    { label: '换手率%',     neutral: 0,  why: '取不到时按无换手数据计，不加分' }
};
function numNeutral(key, raw) {
  const d = NUM_NEUTRAL[key];
  if (!d) { console.error('[numNeutral] 未登记的字段: ' + key); return Number(raw) || 0; }
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  return d.neutral;
}
"""

NEW = """  turnover:    { label: '换手率%',     neutral: 0,  why: '取不到时按无换手数据计，不加分' },
  // ⛔ gap 是**反向**的那一半：profitRatio 取不到给 0 = 压低概率，gap 取不到给 0 = **抬高**概率。
  //    模型里 `z -= 0.28 * gap`，gap=0 的含义是「已在涨停板上」（概率最高档），
  //    所以「没取到」绝不能给 0 —— 那等于默认每只票都已封板。中性取 8（全市场个股距涨停中位约 8~9 点）。
  gap:         { label: '距涨停点数',   neutral: 8,  why: '⛔ gap=0 是「已封板」= 概率最高档，不能当兜底；全市场个股距涨停中位约 8~9 点' }
};
function numNeutral(key, raw) {
  const d = NUM_NEUTRAL[key];
  if (!d) { console.error('[numNeutral] 未登记的字段: ' + key); return Number(raw) || 0; }
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  return d.neutral;
}
// ── 距涨停点数：唯一出口 ──────────────────────────────────────────────────
// ⓵ 限幅必须走 A.limitPctOf（主板10/创业科创20/北交所30/主板ST5），
//    ⛔ 原预选池那处写死 `10 - Math.max(c.pct, 0)` —— 创业板票涨 5% 真实距涨停 15 点却按 5 点算，
//    z 高出 0.28×10=2.8（几率比约 16 倍），专挑涨停最活跃的创业/科创板系统性抬高概率。
// ⓶ pct 取不到时**不能返回 NaN 也不能返回 0**：NaN 会顺着 `z -= 0.28*Math.max(NaN,0)`
//    把整个概率污染成 NaN（1/(1+e^-NaN)=NaN），0 又是「已封板」。一律走中性值。
// ⓷ 返回值只用于**送进模型**；面板展示要另存原始值，取不到就 null 显示 '-'（不许拿中性值冒充真实数）。
function numGap(code, name, pctRaw) {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return NUM_NEUTRAL.gap.neutral;
  let lim = 10;
  try { const v = Number(A.limitPctOf(code, name)); if (Number.isFinite(v) && v > 0) lim = v; } catch (e) { lim = 10; }
  const g = +(lim - pct).toFixed(1);
  return Number.isFinite(g) ? g : NUM_NEUTRAL.gap.neutral;
}
// 距涨停点数的**可空**版本：给面板/文案用，取不到返回 null（显示 '-'），不编数
function numGapRaw(code, name, pctRaw) {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return null;
  let lim = 10;
  try { const v = Number(A.limitPctOf(code, name)); if (Number.isFinite(v) && v > 0) lim = v; } catch (e) { lim = 10; }
  const g = +(lim - pct).toFixed(1);
  return Number.isFinite(g) ? g : null;
}
"""

n = s.count(OLD)
if n != 1:
    print('FAIL step1: OLD count = %d' % n); sys.exit(1)
s = s.replace(OLD, NEW, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('OK step1: NUM_NEUTRAL.gap + numGap + numGapRaw 已写入')
