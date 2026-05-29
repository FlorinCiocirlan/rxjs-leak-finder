import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { SessionStart, SessionDelta } from '../shared/live-protocol.js';
import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';

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

type LiveSession = {
  start: SessionStart;
  lastSeq: number;
  snapshot: { added: SubscriptionTag[]; navigations: NavigationEvent[]; closedIds: string[]; currentRoute: string };
  lastDeltaAtMs: number;
};

type LiveHub = {
  live: Map<string, LiveSession>;
  sseClients: Set<ServerResponse>;
};

const ORPHAN_TTL_MS = 30_000;
const SWEEP_MS = 10_000;
const PING_MS = 15_000;

function sseSend(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(hub: LiveHub, event: string, data: unknown): void {
  for (const c of hub.sseClients) {
    try { sseSend(c, event, data); } catch { hub.sseClients.delete(c); }
  }
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rldDir = join(opts.cwd, '.rld');
  if (!existsSync(rldDir)) mkdirSync(rldDir, { recursive: true });

  const hub: LiveHub = { live: new Map(), sseClients: new Set() };

  const server = createServer((req, res) => handleRequest(req, res, opts, rldDir, hub));
  await new Promise<void>((resolveStart) => server.listen(opts.port, () => resolveStart()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  const ping = setInterval(() => {
    for (const c of hub.sseClients) {
      try { c.write(': ping\n\n'); } catch { hub.sseClients.delete(c); }
    }
  }, PING_MS);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of hub.live) {
      if (now - s.lastDeltaAtMs > ORPHAN_TTL_MS) {
        hub.live.delete(id);
        broadcast(hub, 'session-end', { recordingId: id, fileName: null });
      }
    }
  }, SWEEP_MS);
  // Don't let the keep-alive/sweep timers hold the event loop open if the CLI
  // exits without calling close() (e.g. an unhandled error).
  ping.unref();
  sweep.unref();

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise(r => {
      clearInterval(ping);
      clearInterval(sweep);
      for (const c of hub.sseClients) { try { c.end(); } catch { /* ignore */ } }
      server.close(() => r());
    }),
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
  hub: LiveHub,
): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/report') {
    return handleReport(req, res, rldDir, hub);
  }
  if (req.method === 'POST' && pathname === '/session/start') {
    return handleSessionStart(req, res, hub);
  }
  if (req.method === 'POST' && pathname.startsWith('/session/') && pathname.endsWith('/delta')) {
    return handleSessionDelta(req, res, hub);
  }
  if (req.method === 'GET' && pathname === '/live') {
    return handleLive(req, res, hub);
  }
  if (req.method === 'POST' && pathname === '/open') {
    return handleOpen(req, res, opts.cwd);
  }
  if (req.method === 'GET' && pathname === '/sessions') {
    return handleSessionsList(res, rldDir);
  }
  if (req.method === 'GET' && pathname.startsWith('/sessions/')) {
    return handleSessionGet(res, rldDir, pathname.slice('/sessions/'.length));
  }
  if (req.method === 'GET' && pathname === '/source-maps') {
    const mapUrl = url.searchParams.get('url');
    const raw = url.searchParams.get('raw') === '1';
    return handleSourceMapProxy(res, mapUrl, raw);
  }
  if (req.method === 'GET' && opts.staticDir) {
    return handleStatic(res, opts.staticDir, pathname);
  }

  res.writeHead(404).end('Not found');
}

async function handleSessionStart(req: IncomingMessage, res: ServerResponse, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let start: SessionStart;
  try { start = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  hub.live.set(start.recordingId, {
    start,
    lastSeq: 0,
    snapshot: { added: [], navigations: [], closedIds: [], currentRoute: start.initialRoute },
    lastDeltaAtMs: Date.now(),
  });
  broadcast(hub, 'session-start', start);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

async function handleSessionDelta(req: IncomingMessage, res: ServerResponse, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let delta: SessionDelta;
  try { delta = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const session = hub.live.get(delta.recordingId);
  if (!session) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":false,"stale":true}');
    return;
  }
  session.snapshot.added.push(...delta.added);
  session.snapshot.navigations.push(...delta.navigations);
  session.snapshot.closedIds.push(...delta.closedIds);
  session.snapshot.currentRoute = delta.currentRoute;
  session.lastSeq = delta.seq;
  session.lastDeltaAtMs = Date.now();
  broadcast(hub, 'delta', delta);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

function handleLive(req: IncomingMessage, res: ServerResponse, hub: LiveHub): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  hub.sseClients.add(res);
  for (const s of hub.live.values()) {
    sseSend(res, 'session-start', s.start);
    sseSend(res, 'delta', {
      recordingId: s.start.recordingId,
      seq: s.lastSeq,
      navigations: s.snapshot.navigations,
      added: s.snapshot.added,
      closedIds: s.snapshot.closedIds,
      currentRoute: s.snapshot.currentRoute,
    });
  }
  req.on('close', () => hub.sseClients.delete(res));
}

async function handleOpen(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  const body = await readBody(req);
  let payload: { file?: string; line?: number; column?: number };
  try { payload = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }

  const resolved = resolveSourcePath(payload.file ?? '', cwd);
  if (!resolved) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Could not resolve ${payload.file}` }));
    return;
  }

  const line = Math.max(1, Number(payload.line) || 1);
  const column = Math.max(1, Number(payload.column) || 1);

  const opened = await openInEditor(resolved, line, column);
  res.writeHead(opened.ok ? 200 : 500, { 'content-type': 'application/json' });
  res.end(JSON.stringify(opened));
}

function resolveSourcePath(rawFile: string, cwd: string): string | null {
  if (!rawFile) return null;

  // Strip common bundler prefixes that show up in source-mapped paths.
  let f = rawFile
    .replace(/^webpack:\/\/\/?/, '')
    .replace(/^vite:\/?/, '')
    .replace(/^\.\//, '');

  // Some bundles prefix with the project name: `./projectName/src/...`
  if (isAbsolute(f) && existsSync(f)) return f;

  const candidates = [
    resolve(cwd, f),
    resolve(cwd, 'src', f),
    resolve(cwd, f.replace(/^[^/]+\//, '')), // strip first path segment
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function buildEditorCommand(absPath: string, line: number, column: number): { cmd: string; args: string[] } {
  const editor = (process.env.RLD_EDITOR || 'code').trim();
  // Last path segment in case RLD_EDITOR points to a full path like /usr/local/bin/idea
  const bin = editor.split('/').pop()!.toLowerCase();

  // JetBrains IDEs: `idea --line <n> --column <n> <file>` (or `webstorm`, `pycharm`, etc.)
  if (/^(idea|webstorm|pycharm|rubymine|phpstorm|goland|rustrover|clion|appcode|datagrip|fleet)$/.test(bin)) {
    return { cmd: editor, args: ['--line', String(line), '--column', String(column), absPath] };
  }

  // Sublime Text / Atom: `subl file:line:col`
  if (/^(subl|sublime|atom)$/.test(bin)) {
    return { cmd: editor, args: [`${absPath}:${line}:${column}`] };
  }

  // Vim / Neovim / Emacs (terminal — works if user has a terminal available):
  if (/^(vim|nvim)$/.test(bin)) {
    return { cmd: editor, args: [`+${line}`, absPath] };
  }
  if (/^emacs$/.test(bin)) {
    return { cmd: editor, args: [`+${line}:${column}`, absPath] };
  }

  // Default: VS Code / Cursor / Codium — all accept `code -g file:line:col`.
  return { cmd: editor, args: ['-g', `${absPath}:${line}:${column}`] };
}

function openInEditor(absPath: string, line: number, column: number): Promise<{ ok: boolean; cmd?: string; error?: string }> {
  return new Promise((resolveP) => {
    const { cmd, args } = buildEditorCommand(absPath, line, column);

    const fallback = () => {
      const os = platform();
      const openerCmd = os === 'darwin' ? 'open' : os === 'win32' ? 'explorer' : 'xdg-open';
      const child = spawn(openerCmd, [absPath], { stdio: 'ignore', detached: true });
      child.on('error', (err) => resolveP({ ok: false, error: err.message }));
      child.on('spawn', () => { child.unref(); resolveP({ ok: true, cmd: openerCmd }); });
    };

    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => fallback());
    child.on('spawn', () => { child.unref(); resolveP({ ok: true, cmd: `${cmd} ${args.join(' ')}` }); });
  });
}

async function handleReport(req: IncomingMessage, res: ServerResponse, rldDir: string, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let report: any;
  try { report = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const recordingId = report?.meta?.recordingId ?? randomUUID();
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${recordingId}.json`;
  writeFileSync(join(rldDir, fileName), JSON.stringify(report, null, 2));
  hub.live.delete(recordingId);
  broadcast(hub, 'session-end', { recordingId, fileName });
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

async function handleSourceMapProxy(res: ServerResponse, mapUrl: string | null, raw = false): Promise<void> {
  if (!mapUrl) { res.writeHead(400).end('Missing url param'); return; }
  try {
    const upstream = await fetch(mapUrl);
    if (!upstream.ok) {
      console.log(`[source-maps] ${mapUrl} → ${upstream.status}`);
      res.writeHead(upstream.status).end();
      return;
    }
    const text = await upstream.text();
    if (raw) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(text);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[source-maps] ${mapUrl} → fetch threw: ${msg}`);
    res.writeHead(502).end(msg);
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
