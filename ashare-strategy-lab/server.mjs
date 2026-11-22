import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultPublicDir = fileURLToPath(new URL('./public/', import.meta.url));
const maxBodyBytes = 64 * 1024;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'",
    "img-src 'self' data: blob:", "object-src 'none'", "frame-ancestors 'none'",
    "base-uri 'none'", "form-action 'self'",
  ].join('; '));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function send(request, response, status, contentType, body, cache = 'no-store') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': cache,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function json(request, response, status, value) {
  send(request, response, status, types['.json'], JSON.stringify(value));
}

// Reject traversal text before normalizing paths, including percent-encoded dot segments.
function readPath(url) {
  let pathname;
  try {
    pathname = decodeURIComponent((url || '').split('?')[0]);
  } catch {
    throw new HttpError(400, '地址编码无效');
  }
  if (!pathname.startsWith('/') || /[\\\u0000-\u0020\u007f:]/.test(pathname) ||
      pathname.split('/').some(part => part.startsWith('.'))) {
    throw new HttpError(400, '无效的资源地址');
  }
  return pathname;
}

function insideDirectory(root, target) {
  const subpath = relative(root, target);
  return subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath);
}

async function sendStatic(request, response, publicRoot, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const type = types[extname(file).toLowerCase()];
  if (!type) throw new HttpError(404, '文件不存在');
  try {
    // Check canonical paths as well as the request path so symlinks cannot escape public/.
    const target = await realpath(join(publicRoot, file));
    if (!insideDirectory(publicRoot, target) || !(await stat(target)).isFile()) {
      throw new HttpError(404, '文件不存在');
    }
    send(request, response, 200, type, await readFile(target), 'no-cache');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code)) {
      throw new HttpError(404, '文件不存在');
    }
    throw error;
  }
}

function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, '请使用 application/json 请求');
  }
  if (Number(request.headers['content-length']) > maxBodyBytes) {
    throw new HttpError(413, '录入数据超过 64 KiB');
  }
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        chunks.length = 0;
        rejectBody(new HttpError(413, '录入数据超过 64 KiB'));
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', rejectBody);
    request.once('end', () => {
      if (size > maxBodyBytes) return;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new TypeError('expected object');
        }
        resolveBody(input);
      } catch {
        rejectBody(new HttpError(400, '请提交有效的 JSON 对象'));
      }
    });
  });
}

function requireMethod(request, response, allowed) {
  if (allowed.includes(request.method)) return;
  response.setHeader('Allow', allowed.join(', '));
  throw new HttpError(405, '请求方法不支持');
}

/** Starts with the same stateless evaluator that the browser imports. */
export async function createAppServer({ publicDir = defaultPublicDir, evaluator } = {}) {
  const publicRoot = await realpath(publicDir);
  const evaluateCase = evaluator ?? (await import('./public/engine.mjs')).evaluate;
  if (typeof evaluateCase !== 'function') throw new TypeError('策略引擎缺少 evaluate 函数');

  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 },
    async (request, response) => {
      setSecurityHeaders(response);
      try {
        const pathname = readPath(request.url);
        if (pathname === '/api/health') {
          requireMethod(request, response, ['GET', 'HEAD']);
          json(request, response, 200, { ok: true, service: 'ashare-strategy-lab', mode: 'research' });
          return;
        }
        if (pathname === '/api/evaluate') {
          requireMethod(request, response, ['POST']);
          const input = await readJson(request);
          try {
            json(request, response, 200, evaluateCase(input));
          } catch (error) {
            if (error instanceof TypeError || error instanceof RangeError) {
              throw new HttpError(400, error.message.slice(0, 180) || '录入数据无效');
            }
            throw error;
          }
          return;
        }
        requireMethod(request, response, ['GET', 'HEAD']);
        if (pathname === '/api' || pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
        await sendStatic(request, response, publicRoot, pathname);
      } catch (error) {
        if (response.destroyed || response.writableEnded) return;
        if (!request.complete) request.resume();
        if (error.status === 413 || error.status === 415) response.setHeader('Connection', 'close');
        const status = error instanceof HttpError ? error.status : 500;
        if (status === 500) console.error('处理请求失败');
        json(request, response, status, { error: status === 500 ? '服务暂不可用' : error.message });
      }
    });
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('请使用 Node.js 20 或更新版本');
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数');
  const server = await createAppServer();
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可用 PORT 指定其他端口` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = host.includes(':') ? `[${host}]` : host;
    console.log(`短线研究台 http://${address}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
