// 小程序页面预览服务。把小程序目录里的 wxml / wxss / ts 原样交给浏览器里的运行时，
// ts 按需转成 CommonJS；wx.request 经本服务转发，跟真机一样不受浏览器跨域限制。
// 只在本机开发和截图时用，不要部署。

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, 'runtime');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wxml': 'text/plain; charset=utf-8',
  '.wxss': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/** 只允许读根目录里面的文件。 */
function inside(root, relative) {
  const full = normalize(join(root, relative));
  return full === root || full.startsWith(root + sep) ? full : null;
}

function isFile(path) {
  return path != null && existsSync(path) && statSync(path).isFile();
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

/** 转发 wx.request。返回结构对齐真机的 success 回调：statusCode、data、header。 */
async function forward(req, res) {
  const { url, method = 'GET', header = {}, body } = JSON.parse(await readBody(req));
  try {
    const reply = await fetch(url, { method, headers: header, body: body ?? undefined });
    const text = await reply.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // 不是 JSON 就按文本返回，和真机一致。
    }
    send(
      res,
      200,
      JSON.stringify({ ok: true, statusCode: reply.status, data, header: Object.fromEntries(reply.headers) }),
      TYPES['.json'],
    );
  } catch (error) {
    send(res, 200, JSON.stringify({ ok: false, errMsg: `request:fail ${error.message}` }), TYPES['.json']);
  }
}

export function startServer({ appDir, port = 0 }) {
  const appRoot = resolve(appDir);
  const ts = createRequire(join(appRoot, 'package.json'))('typescript');

  function transpile(path) {
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
    });
    return output.outputText;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://preview');
    const path = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'POST' && path === '/__request') {
        await forward(req, res);
        return;
      }
      if (path === '/' || path === '/index.html') {
        send(res, 200, readFileSync(join(runtimeDir, 'index.html')), TYPES['.html']);
        return;
      }
      if (path.startsWith('/runtime/')) {
        const file = inside(runtimeDir, path.slice('/runtime/'.length));
        if (!isFile(file)) return send(res, 404, 'not found');
        send(res, 200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
        return;
      }
      if (path.startsWith('/app/')) {
        const relative = path.slice('/app/'.length);
        const file = inside(appRoot, relative);
        if (isFile(file)) {
          send(res, 200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
          return;
        }
        // 页面和工具代码用 TypeScript 写，浏览器要 .js 时现转。
        if (relative.endsWith('.js')) {
          const source = inside(appRoot, relative.replace(/\.js$/, '.ts'));
          if (isFile(source)) {
            send(res, 200, transpile(source), TYPES['.js']);
            return;
          }
        }
        send(res, url.searchParams.has('optional') ? 204 : 404, '');
        return;
      }
      send(res, 404, 'not found');
    } catch (error) {
      send(res, 500, String(error?.stack ?? error));
    }
  });

  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      done({
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((closed) => server.close(closed)),
      });
    });
  });
}

// 直接运行：node tools/mp-preview/server.mjs apps/member-mp [端口]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = process.argv[2];
  if (!appDir) {
    console.error('用法：node tools/mp-preview/server.mjs <小程序目录> [端口]');
    process.exit(1);
  }
  const { url } = await startServer({ appDir, port: Number(process.argv[3] ?? 5180) });
  console.log(`预览地址 ${url}/?route=<页面路径>`);
}
