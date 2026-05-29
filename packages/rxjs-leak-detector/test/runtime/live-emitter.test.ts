import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLiveEmitter } from '../../src/runtime/live-emitter.js';

function fakeRecorder() {
  return {
    isRecording: true,
    currentRecordingId: 'rec-1',
    initialRoute: '/',
    startedAtMs: 0,
    drainDelta: vi.fn(() => ({ recordingId: 'rec-1', seq: 1, navigations: [], added: [], closedIds: [], currentRoute: '/x' })),
    liveCandidateCount: vi.fn(() => 2),
  } as any;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('startLiveEmitter', () => {
  it('POSTs /session/start on creation', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    startLiveEmitter({ recorder: fakeRecorder(), dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    expect(fetchMock).toHaveBeenCalledWith('http://d/session/start', expect.objectContaining({ method: 'POST' }));
  });

  it('drainNow POSTs a delta and updates the widget count', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const widget = { setLeakCount: vi.fn() } as any;
    const rec = fakeRecorder();
    const em = startLiveEmitter({ recorder: rec, dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget });
    fetchMock.mockClear();
    em.drainNow();
    expect(fetchMock).toHaveBeenCalledWith('http://d/session/rec-1/delta', expect.objectContaining({ method: 'POST' }));
    expect(widget.setLeakCount).toHaveBeenCalledWith(2);
  });

  it('heartbeat timer drains every ~2s until stopped', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const rec = fakeRecorder();
    const em = startLiveEmitter({ recorder: rec, dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    rec.drainDelta.mockClear();
    vi.advanceTimersByTime(4100);
    expect(rec.drainDelta).toHaveBeenCalledTimes(2);
    em.stop();
    vi.advanceTimersByTime(4000);
    expect(rec.drainDelta).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch failures', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('down')) as any;
    const em = startLiveEmitter({ recorder: fakeRecorder(), dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    expect(() => em.drainNow()).not.toThrow();
  });
});
