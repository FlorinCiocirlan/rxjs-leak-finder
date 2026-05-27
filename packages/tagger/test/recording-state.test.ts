import { describe, it, expect, beforeEach } from 'vitest';
import { createRecordingApi } from '../src/recording-state.js';

describe('recording state machine', () => {
  beforeEach(() => {
    delete (globalThis as any).__rld_session;
  });

  it('start() initializes session and flips isRecording', () => {
    const api = createRecordingApi();
    api.start();
    expect(api.isRecording).toBe(true);
    const session = (globalThis as any).__rld_session;
    expect(session.isRecording).toBe(true);
    expect(session.recordingId).toBeTypeOf('string');
    expect(session.recordingId.length).toBeGreaterThan(0);
  });

  it('stop() returns meta with at least one navigation when recorded', () => {
    const api = createRecordingApi();
    api.start();
    api.recordNavigation({ from: '/a', to: '/b' });
    const meta = api.stop();
    expect(meta.navigations).toHaveLength(1);
    expect(meta.initialRoute).toBe('/a');
    expect(api.isRecording).toBe(false);
  });

  it('markNavigation() pushes a synthetic navigation', () => {
    const api = createRecordingApi();
    api.start();
    api.markNavigation();
    const meta = api.stop();
    expect(meta.navigations.length).toBeGreaterThanOrEqual(1);
  });

  it('start() while recording resets the session', () => {
    const api = createRecordingApi();
    api.start();
    const firstId = (globalThis as any).__rld_session.recordingId;
    api.start();
    const secondId = (globalThis as any).__rld_session.recordingId;
    expect(secondId).not.toBe(firstId);
  });
});
