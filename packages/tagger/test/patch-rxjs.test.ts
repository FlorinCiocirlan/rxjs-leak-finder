import { describe, it, expect, beforeAll } from 'vitest';
import { Observable, interval, Subject } from 'rxjs';
import { installPatch, isInstalled } from '../src/patch-rxjs.js';

function freshSession() {
  return {
    recordingId: 'rec-1',
    initialRoute: '/x',
    isRecording: true,
    currentRoute: '/x',
    stackHashCache: new Map<string, string>(),
  };
}

beforeAll(async () => {
  (globalThis as any).Observable = Observable;
  await installPatch();
});

describe('installPatch', () => {
  it('marks installed and is idempotent', async () => {
    await installPatch();
    expect(isInstalled()).toBe(true);
  });

  it('tags a new Subscription with full meta when isRecording is true', () => {
    (globalThis as any).__rld_session = freshSession();
    const obs = new Observable<number>((observer) => { observer.next(1); observer.complete(); });
    const sub = obs.subscribe(() => {});
    const meta = (sub as any).__sw_meta;
    expect(meta).toBeDefined();
    expect(meta.recordingId).toBe('rec-1');
    expect(meta.route).toBe('/x');
    expect(meta.id).toBeTypeOf('string');
    expect(meta.createdAtMs).toBeTypeOf('number');
    expect(meta.stackRaw).toBeTypeOf('string');
    expect(meta.closed).toBe(false);
  });

  it('flips closed=true on unsubscribe', () => {
    (globalThis as any).__rld_session = freshSession();
    const sub = new Subject<void>().subscribe(() => {});
    sub.unsubscribe();
    expect((sub as any).__sw_meta.closed).toBe(true);
  });

  it('detects observableKind from .source chain', () => {
    (globalThis as any).__rld_session = freshSession();
    const sub = interval(1000).subscribe(() => {});
    expect((sub as any).__sw_meta.observableKind).toMatch(/Interval/i);
    sub.unsubscribe();
  });

  it('skips heavy fields when isRecording is false', () => {
    const session = freshSession();
    session.isRecording = false;
    (globalThis as any).__rld_session = session;
    const sub = new Subject<void>().subscribe(() => {});
    expect((sub as any).__sw_meta.recordingId).toBe('');
    expect((sub as any).__sw_meta.stackRaw).toBe('');
  });
});
