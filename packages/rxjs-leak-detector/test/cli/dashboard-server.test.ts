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

  it('broadcasts session-start and delta to a connected /live client', async () => {
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();

    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0 }),
    });
    await fetch(`${server.url}/session/rec-1/delta`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', seq: 1, navigations: [], added: [], closedIds: [], currentRoute: '/x' }),
    });

    let buf = '';
    while (!(buf.includes('event: session-start') && buf.includes('event: delta'))) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: session-start');
    expect(buf).toContain('event: delta');
    expect(buf).toContain('"currentRoute":"/x"');
    ac.abort();
  });

  it('POST /report broadcasts session-end and still writes the file', async () => {
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();

    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0 }),
    });
    await fetch(`${server.url}/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });

    let buf = '';
    while (!buf.includes('event: session-end')) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: session-end');
    expect(readdirSync(join(cwd, '.rld'))).toHaveLength(1);
    ac.abort();
  });

  it('replays the current live session to a late /live client', async () => {
    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/home', startedAtMs: 0 }),
    });
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('event: session-start')) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('"recordingId":"rec-1"');
    ac.abort();
  });
});
