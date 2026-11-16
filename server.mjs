import { createApi } from './backend.mjs';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { networkInterfaces } from 'node:os';

// 内网预览只暴露页面资源；项目配置、测试和其他磁盘文件不作为静态资源提供。
const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export function createPreviewServer(api = null, {reportOnly = false} = {}) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (reportOnly && !(
      (request.method === 'GET' && ['/api/v1/report-cursor','/api/v1/report-directory'].includes(request.url.split('?')[0])) ||
      (request.method === 'POST' && request.url === '/api/v1/reports')
    )) {
      response.writeHead(404).end();
      return;
    }
    if (request.url.startsWith('/api/')) {
      if (!api) { response.writeHead(404).end(); return; }
      return api.handle(request,response,new URL(request.url,'http://localhost'));
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(request.url.split('?')[0]); }
    catch { response.writeHead(400).end('Bad request'); return; }
    if (pathname === '/') pathname = api ? '/assets/live-workspace.html' : '/index.html';
    const allowed = pathname === '/index.html' || /^\/(?:src|assets)\//.test(pathname);
    if (!allowed || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..')) {
      response.writeHead(404).end('Not found');
      return;
    }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root) || !mime[path.extname(filename)]) {
      response.writeHead(404).end('Not found'); return;
    }
    try {
      if (!(await stat(filename)).isFile()) throw new Error('Not a file');
      const body = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mime[path.extname(filename)], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404).end('Not found'); }
  });
  if (api) server.once('close', () => { void api.close(); });
  return server;
}

/** 仅列出本机私有 IPv4 地址，便于同一局域网的设备打开预览。 */
export function networkPreviewUrls(port, interfaces=networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(item=>item&&!item.internal&&(item.family==='IPv4'||item.family===4)
    && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item=>`http://${item.address}:${port}/`))];
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const requestedPort = Number(process.argv[2] || process.env.PORT || 4174);
  const bindHost = process.env.PULSE_HOST || '127.0.0.1';
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new Error('端口必须是 1 到 65535 的整数');
  const localView = process.env.PULSE_LOCAL_VIEW === '1';
  if (localView && bindHost !== '127.0.0.1') throw new Error('PULSE_LOCAL_VIEW requires PULSE_HOST=127.0.0.1');
  const reportOnly = process.env.PULSE_REPORT_ONLY === '1';
  const lanEnrollment = process.env.PULSE_LAN_ENROLLMENT === '1';
  const server = createPreviewServer(createApi({localView,lanEnrollment}), {reportOnly});
  let port = requestedPort;
  server.on('error', error => {
    if (!reportOnly && error.code === 'EADDRINUSE' && port < Math.min(requestedPort + 10, 65535)) server.listen(++port, bindHost);
    else { console.error(`预览服务启动失败：${error.code || 'UNKNOWN'}`); process.exitCode = 1; }
  });
  server.on('listening', () => {
    console.log(`Project Pulse ${reportOnly ? '上报入口' : '预览'}：http://${bindHost}:${port}/`);
    if(bindHost==='0.0.0.0') for(const url of networkPreviewUrls(port)) console.log(`内网预览：${url}`);
  });
  server.listen(port, bindHost);
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
