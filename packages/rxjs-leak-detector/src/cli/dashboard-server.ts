import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export type StartServerOptions = {
  port: number;
  cwd: string;
  staticDir: string | undefined;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rldDir = join(opts.cwd, '.rld');
  if (!existsSync(rldDir)) mkdirSync(rldDir, { recursive: true });

  const server = createServer((req, res) => handleRequest(req, res, opts, rldDir));
  await new Promise<void>((resolveStart) => server.listen(opts.port, () => resolveStart()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise(r => server.close(() => r())),
  };
}

function setCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartServerOptions,
  rldDir: string,
): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/report') {
    return handleReport(req, res, rldDir);
  }
  if (req.method === 'GET' && pathname === '/sessions') {
    return handleSessionsList(res, rldDir);
  }
  if (req.method === 'GET' && pathname.startsWith('/sessions/')) {
    return handleSessionGet(res, rldDir, pathname.slice('/sessions/'.length));
  }
  if (req.method === 'GET' && pathname === '/source-maps') {
    const mapUrl = url.searchParams.get('url');
    return handleSourceMapProxy(res, mapUrl);
  }
  if (req.method === 'GET' && opts.staticDir) {
    return handleStatic(res, opts.staticDir, pathname);
  }

  res.writeHead(404).end('Not found');
}

async function handleReport(req: IncomingMessage, res: ServerResponse, rldDir: string): Promise<void> {
  const body = await readBody(req);
  let report: any;
  try { report = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const recordingId = report?.meta?.recordingId ?? randomUUID();
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${recordingId}.json`;
  writeFileSync(join(rldDir, fileName), JSON.stringify(report, null, 2));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, fileName }));
}

function handleSessionsList(res: ServerResponse, rldDir: string): void {
  const files = readdirSync(rldDir).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    const parsed = JSON.parse(readFileSync(join(rldDir, f), 'utf8'));
    return {
      id: f.replace(/\.json$/, ''),
      fileName: f,
      recordingId: parsed?.meta?.recordingId ?? null,
      createdAt: parsed?.meta?.startedAtMs ?? null,
      subscriptionCount: parsed?.subscriptions?.length ?? 0,
    };
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(list));
}

function handleSessionGet(res: ServerResponse, rldDir: string, id: string): void {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = join(rldDir, `${safe}.json`);
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(readFileSync(file));
}

async function handleSourceMapProxy(res: ServerResponse, mapUrl: string | null): Promise<void> {
  if (!mapUrl) { res.writeHead(400).end('Missing url param'); return; }
  try {
    const upstream = await fetch(mapUrl);
    if (!upstream.ok) { res.writeHead(upstream.status).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(await upstream.text());
  } catch (err) {
    res.writeHead(502).end(String(err));
  }
}

function handleStatic(res: ServerResponse, staticDir: string, pathname: string): void {
  const filePath = resolve(staticDir, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!filePath.startsWith(resolve(staticDir))) { res.writeHead(403).end(); return; }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback to index.html
    const index = resolve(staticDir, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html']! });
      res.end(readFileSync(index));
      return;
    }
    res.writeHead(404).end();
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
