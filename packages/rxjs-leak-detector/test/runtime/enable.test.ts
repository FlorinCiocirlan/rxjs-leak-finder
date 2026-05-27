import { describe, it, expect, beforeEach } from 'vitest';
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from '../../src/runtime/enable.js';

beforeEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).__rldController;
});

describe('enableRxjsLeakDetector', () => {
  it('installs the patch and mounts the widget', () => {
    enableRxjsLeakDetector(Observable);
    expect(document.getElementById('__rld_widget')).toBeTruthy();
  });

  it('respects disableWidget', () => {
    enableRxjsLeakDetector(Observable, { disableWidget: true });
    expect(document.getElementById('__rld_widget')).toBeFalsy();
  });

  it('bails when enabled: false', () => {
    enableRxjsLeakDetector(Observable, { enabled: false });
    expect(document.getElementById('__rld_widget')).toBeFalsy();
  });

  it('exposes controller on window.__rldController', () => {
    enableRxjsLeakDetector(Observable);
    const c = (window as any).__rldController;
    expect(c).toBeDefined();
    expect(typeof c.start).toBe('function');
    expect(typeof c.stop).toBe('function');
  });

  it('is idempotent — second call returns same controller', () => {
    const a = enableRxjsLeakDetector(Observable);
    const b = enableRxjsLeakDetector(Observable);
    expect(a).toBe(b);
  });
});
