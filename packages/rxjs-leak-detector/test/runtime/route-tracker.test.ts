import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installRouteTracker } from '../../src/runtime/route-tracker.js';

describe('installRouteTracker (URL fallback)', () => {
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = vi.fn();
    window.history.replaceState({}, '', '/initial');
  });

  it('fires listener with current URL on pushState', () => {
    const stop = installRouteTracker(listener);
    window.history.pushState({}, '', '/page-a');
    expect(listener).toHaveBeenCalledWith({ from: '/initial', to: '/page-a' });
    stop();
  });

  it('fires listener on hashchange', () => {
    const stop = installRouteTracker(listener);
    window.location.hash = '#section';
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: 'http://localhost/initial', newURL: 'http://localhost/initial#section' }));
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it('returned stop() detaches listeners', () => {
    const stop = installRouteTracker(listener);
    stop();
    window.history.pushState({}, '', '/page-b');
    expect(listener).not.toHaveBeenCalled();
  });
});
