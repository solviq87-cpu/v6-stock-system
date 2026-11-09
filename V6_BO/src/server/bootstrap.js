'use strict';

const http = require('http');
const { AsyncLocalStorage } = require('async_hooks');
const { decorateQuantPicksResponse } = require('./forward-tracking-projection');

/**
 * HTTP 基础设施层：统一处理 CORS、请求体上限和手动请求上下文。
 * 业务路由仍由 server.js 的 handle() 负责，避免一次性大拆导致行为变化。
 */
function createDashboardServer({ handle, sameOriginOk, bodyLimit, onListen, port, host, forwardTrackingFile=process.env.V6_FORWARD_TRACKING_REPORT_FILE }) {
  if (typeof handle !== 'function') throw new TypeError('handle 必须是函数');
  if (typeof sameOriginOk !== 'function') throw new TypeError('sameOriginOk 必须是函数');
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) throw new RangeError('bodyLimit 必须为正整数');
  const pushContext = new AsyncLocalStorage();
  const inManualPush = () => !!pushContext.getStore();

  const server = http.createServer((req, res) => {
    let u;
    let sourceOk;
    try {
      u = new URL(req.url, 'http://x');
      sourceOk = sameOriginOk(req);
    } catch (err) {
      console.error('[http preflight]', err && err.stack || err);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '请求地址或来源校验失败' }));
      return;
    }
    if (sourceOk && req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    }
    if (!sourceOk && u.pathname.startsWith('/api/')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '跨站请求已被拒绝（来源与站点不一致）' }));
      return;
    }

    const fail = (err) => {
      console.error('[http handler]', err && err.stack || err);
      if (res.writableEnded || res.destroyed) return;
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '服务器内部错误' }));
      } else {
        res.destroy(err);
      }
    };
    const dispatch = (body) => {
      try {
        // Only decorate the existing authorized, successful stock result response.
        // No new route or write access; disabled unless explicitly configured.
        if (req.method === 'GET' && u.pathname === '/api/quant-picks' && forwardTrackingFile)
          decorateQuantPicksResponse(res, {stateFile:forwardTrackingFile});
        Promise.resolve(pushContext.run({ manual: true }, () => handle(req, res, u, body))).catch(fail);
      } catch (err) {
        fail(err);
      }
    };
    if (req.method !== 'POST') return dispatch(null);

    // 对明确声明超限的请求提前拒绝，不等待完整上传。
    // 关闭连接，避免未消费的请求体影响下一次 keep-alive 请求。
    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined && /^\d+$/.test(declaredLength) &&
        Number(declaredLength) > bodyLimit) {
      res.setHeader('Connection', 'close');
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '请求体超过大小上限，已拒绝' }));
      return;
    }

    let size = 0;
    const chunks = [];
    let overflow = false;
    req.on('data', chunk => {
      if (overflow) return;
      // 比较剩余容量，避免极大 bodyLimit 下累计字节数出现整数精度问题。
      if (chunk.length > bodyLimit - size) {
        overflow = true;
        chunks.length = 0;
        // 流式/分块上传同样立即拒绝，不等待客户端发送结束标记。
        // 保持连接关闭，避免剩余正文被当成下一个 HTTP 请求。
        res.setHeader('Connection', 'close');
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '请求体超过大小上限，已拒绝' }));
        return;
      }
      size += chunk.length;
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow || res.writableEnded || res.destroyed) return;
      dispatch(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: '请求读取失败' }));
    });
  });

  // 防止慢请求长期占用连接；不修改 SSE/长连接的业务响应行为。
  // requestTimeout 限制接收完整请求的时间；headersTimeout 限制请求头时间。
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 200;
  server.listen(port, host, onListen);
  return { server, inManualPush };
}

module.exports = { createDashboardServer };
