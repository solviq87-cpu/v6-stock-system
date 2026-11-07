# -*- coding: utf-8 -*-
# dr 轮补修：把「在数字前写死 + 号 / 写死涨色」的写法全部收口到唯一出口。
# ⛔ 不中途 sys.exit（会让整份不落盘）→ 收集失败，最后统一写盘并报告。
import io, sys

errs = []

def sub(path, old, new, want=1, enc="utf-8"):
    with io.open(path, "r", encoding=enc, newline="") as f:
        s = f.read()
    n = s.count(old)
    if n != want:
        errs.append("%s: 期望 %d 处，实到 %d 处 :: %s" % (path, want, n, old[:70]))
        return
    s = s.replace(old, new)
    with io.open(path, "w", encoding=enc, newline="") as f:
        f.write(s)
    print("  ✓ %s  x%d :: %s" % (path.split("\\")[-1], n, old[:52]))

# ── server.js ────────────────────────────────────────────
print("① server.js: 新增 signTxt / signNum，ppTxt 复用")

SIGN_BLOCK = """// ⛔⛔ 正负号不许写死（dr 轮实证）：`+${v}` 在 v 为负时打出 `+-1.7`，
//    而 `class="up"` 写死会让下跌显示成红色（涨红跌绿口径下正好说反）。
//    线上实证：学习模块「首次自动修正评分 +-1.7」共 9 处 —— 那是**负修正**被读成正的。
//    ⛔ 判据：**凡是「可能为正也可能为负」的数，符号与配色必须由值自己决定**。
//    signTxt 只给符号（值由调用方决定怎么格式化）；signNum 连值带单位一起产出。
function signTxt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? '+' : '';
}
function signNum(v, unit) {
  if (v == null) return '-';                 // ⛔ 判空在转数字之前
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  const r = Math.round(n * 10) / 10;
  return (r > 0 ? '+' : '') + r + (unit || '');
}
function stateCut() {"""

sub("server.js", "function stateCut() {", SIGN_BLOCK, 1)

# ppTxt 改为复用 signNum（行为不变，仍保留 signed 参数语义）
sub("server.js",
    """  const r = Math.round(n * 10) / 10;
  return (signed !== false && r > 0 ? '+' : '') + r + 'pp';
}""",
    """  const r = Math.round(n * 10) / 10;
  return (signed !== false && r > 0 ? '+' : '') + r + 'pp';   // 同 signNum，只是单位是 pp
}""", 1)

print("② server.js: 替换写死正号的 6 处")
sub("server.js", "首次自动修正评分 +${v.adj}", "首次自动修正评分 ${signNum(v.adj)}", 1)
sub("server.js", "30秒主力净流入+${inf(sg.delta)}", "30秒主力净流入${signTxt(sg.delta)}${inf(sg.delta)}", 1)
sub("server.js", "累计+${x.cum}%", "累计${signTxt(x.cum)}${x.cum}%", 1)
sub("server.js", "累计+${cum8.toFixed(1)}%", "累计${signTxt(cum8)}${cum8.toFixed(1)}%", 1)
sub("server.js", "累计+${t.sum8}%", "累计${signTxt(t.sum8)}${t.sum8}%", 2)
sub("server.js", "现价偏离5日线+${t.dev.toFixed(1)}%", "现价偏离5日线${signTxt(t.dev)}${t.dev.toFixed(1)}%", 1)

# ── public/index.html ────────────────────────────────────
print("③ index.html: sign 加空值兜底 + 替换写死正号/涨色")
sub("public/index.html",
    "const sign = v => v > 0 ? '+' + v : v;",
    "const sign = v => (v == null || v === '') ? '-' : (Number(v) > 0 ? '+' + v : v);", 1)
sub("public/index.html",
    """<span>近8日 <b class="up">+${x.sum8}%</b>（${x.yang8}根小阳）</span>""",
    """<span>近8日 <b class="${cls(x.sum8)}">${sign(x.sum8)}%</b>（${x.yang8}根小阳）</span>""", 1)
sub("public/index.html",
    """<span>累计 <b class="up">+${x.cum}%</b></span>""",
    """<span>累计 <b class="${cls(x.cum)}">${sign(x.cum)}%</b></span>""", 1)
sub("public/index.html", "累计+${x.sum8}%", "累计${sign(x.sum8)}%", 2)

print()
if errs:
    print("❌ 失败 %d 项：" % len(errs))
    for e in errs:
        print("   " + e)
else:
    print("✅ 全部替换成功")
