/**
 * Call this from your app's main.ts to enable the RxJS Leak Detector
 * Chrome extension to find your app's RxJS Observable prototype:
 *
 *   import { Observable } from 'rxjs';
 *   import { enableRxjsLeakDetector } from '@rld/runtime';
 *   enableRxjsLeakDetector(Observable);
 *
 * Safe to call in production — it's a no-op when the extension isn't installed.
 */
export function enableRxjsLeakDetector(Observable: unknown): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).__rldObservable = Observable;
  window.dispatchEvent(new CustomEvent('rld:observable-ready'));
}
