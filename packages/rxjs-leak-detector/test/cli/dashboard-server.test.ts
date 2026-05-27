import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '../../src/cli/dashboard-server.js';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cwd: string;
let server: ServerHandle;

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'rld-test-'));
  server = await startServer({ port: 0, cwd, staticDir: undefined });
});

afterEach(async () => {
  await server.close();
  rmSync(cwd, { recursive: true, force: true });
});

const sampleReport = {
  meta: { recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, stoppedAtMs: 1000, navigations: [{ fromRoute: '/', toRoute: '/x', atMs: 500 }] },
  subscriptions: [],
};

describe('dashboard-server', () => {
  it('accepts POST /report and writes a file to .rld/', async () => {
    const res = await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    expect(res.ok).toBe(true);
    const files = readdirSync(join(cwd, '.rld'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('GET /sessions lists committed reports', async () => {
    await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    const res = await fetch(`${server.url}/sessions`);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].recordingId).toBe('rec-1');
  });

  it('GET /sessions/:id returns the full report', async () => {
    await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    const list = await (await fetch(`${server.url}/sessions`)).json();
    const id = list[0].id;
    const res = await fetch(`${server.url}/sessions/${id}`);
    const body = await res.json();
    expect(body.meta.recordingId).toBe('rec-1');
  });

  it('serves CORS preflight for POST /report', async () => {
    const res = await fetch(`${server.url}/report`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
