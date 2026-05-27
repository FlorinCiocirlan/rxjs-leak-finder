import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendReport, flushQueue } from '../../src/runtime/transport.js';
import type { RecordingReport } from '../../src/runtime/types.js';

const sampleReport: RecordingReport = {
  meta: {
    recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0,
    stoppedAtMs: 1000, navigations: [{ fromRoute: '/', toRoute: '/x', atMs: 500 }],
  },
  subscriptions: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sendReport', () => {
  it('POSTs the report to dashboardUrl/report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7654/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('enqueues to localStorage on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    const queue = JSON.parse(localStorage.getItem('__rld_queue') ?? '[]');
    expect(queue).toHaveLength(1);
  });

  it('enqueues on non-OK HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    const queue = JSON.parse(localStorage.getItem('__rld_queue') ?? '[]');
    expect(queue).toHaveLength(1);
  });
});

describe('flushQueue', () => {
  it('retries all queued reports and clears on success', async () => {
    localStorage.setItem('__rld_queue', JSON.stringify([sampleReport, sampleReport]));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;
    await flushQueue('http://localhost:7654');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('__rld_queue')).toBe('[]');
  });

  it('leaves reports in queue if all fail', async () => {
    localStorage.setItem('__rld_queue', JSON.stringify([sampleReport]));
    global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any;
    await flushQueue('http://localhost:7654');
    expect(JSON.parse(localStorage.getItem('__rld_queue')!)).toHaveLength(1);
  });
});
