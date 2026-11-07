"use strict";
// 诊断：模拟 DOM 跑 index.html 渲染函数，定位桌面端"面板刷新出错"源头
const fs = require("fs");
const http = require("http");

// ── Mock DOM ──
const elements = {};
function mkEl(id) {
  const el = {
    id: id || "",
    innerHTML: "", textContent: "", style: {}, className: "",
    children: [], attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    toggle() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    get isConnected() { return true; },
    scrollHeight: 0, clientHeight: 0, scrollTop: 0,
    classList: { toggle() {}, add() {}, remove() {} },
    dataset: {},
    placeholder: "", title: "", disabled: false, value: "", checked: false
  };
  return el;
}
const document = {
  getElementById(id) { if (!elements[id]) elements[id] = mkEl(id); return elements[id]; },
  createElement(tag) { return mkEl(""); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  body: mkEl("body"),
  addEventListener() {},
  readyState: "complete",
  hidden: false
};
const window = { addEventListener() {}, innerWidth: 1280 };
const navigator = { userAgent: "node-test", sendBeacon: null };
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const location = { href: "http://localhost/", search: "" };

// ── 提取 index.html 内联脚本 ──
const html = fs.readFileSync("public/index.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("no script"); process.exit(1); }
let src = m[1];

// 屏蔽自动执行块（初始化调用）
src = src.replace(/initHdrTools\(\);[\s\S]*?\(async \(\) => \{[\s\S]*?\}\)\(\);/, "");

// 构造执行环境
const fn = new Function(
  "document", "window", "navigator", "localStorage", "location",
  "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "console",
  "AbortController", "URLSearchParams", "Date", "Math", "JSON", "Object", "Array",
  "String", "Number", "Boolean", "Promise", "Error", "TypeError", "RegExp", "Map", "Set",
  src + "\n;return { refresh, renderReleaseBoard, loadReleaseBoard };"
);

const fetchMock = (url, opts) => Promise.resolve({
  json: () => new Promise((resolve, reject) => {
    if (url.indexOf("/api/state") >= 0) {
      http.get("http://127.0.0.1:8787/api/state", res => {
        let d = ""; res.on("data", c => d += c);
        res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on("error", reject);
    } else if (url.indexOf("/api/release/requests") >= 0) {
      http.get("http://127.0.0.1:8787/api/release/requests", res => {
        let d = ""; res.on("data", c => d += c);
        res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on("error", reject);
    } else {
      resolve({ ok: false, error: "not mocked" });
    }
  })
});

const AC = function() { this.abort = () => {}; this.signal = {}; };

(async () => {
  try {
    const api = fn(document, window, navigator, localStorage, location,
      fetchMock, setTimeout, clearTimeout, setInterval, clearInterval, console,
      AC, URLSearchParams, Date, Math, JSON, Object, Array,
      String, Number, Boolean, Promise, Error, TypeError, RegExp, Map, Set);
    await api.refresh();
    console.log("✅ refresh() 执行成功，无渲染错误");
  } catch (e) {
    console.error("❌ refresh() 抛错：", e.message);
    console.error("堆栈:", (e.stack || "").split("\n").slice(0, 8).join("\n"));
  }
  process.exit(0);
})();
