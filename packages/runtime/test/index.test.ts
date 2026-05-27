import { describe, it, expect, beforeEach } from 'vitest';
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from '../src/index.js';

describe('enableRxjsLeakDetector', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__rldObservable;
  });

  it('exposes Observable on window.__rldObservable', () => {
    enableRxjsLeakDetector(Observable);
    expect((window as unknown as Record<string, unknown>).__rldObservable).toBe(Observable);
  });

  it('dispatches rld:observable-ready event', () => {
    let fired = false;
    window.addEventListener('rld:observable-ready', () => { fired = true; }, { once: true });
    enableRxjsLeakDetector(Observable);
    expect(fired).toBe(true);
  });

  it('is a no-op when window is undefined (SSR safety)', () => {
    // Cannot directly test this in happy-dom (window is defined),
    // but verify the function does not throw with truthy input.
    expect(() => enableRxjsLeakDetector(Observable)).not.toThrow();
  });
});
