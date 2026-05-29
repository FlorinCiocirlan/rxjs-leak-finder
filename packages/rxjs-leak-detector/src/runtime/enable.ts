import { installPatch } from './patch.js';
import { createRecorder } from './recorder.js';
import { installRouteTracker } from './route-tracker.js';
import { mountWidget, type WidgetController } from './widget.js';
import { sendReport, flushQueue } from './transport.js';
import { startLiveEmitter, type LiveEmitter } from './live-emitter.js';
import type { EnableConfig, PatchableObservable } from './types.js';

const CONTROLLER_GLOBAL_KEY = '__rldController';

export type LeakDetectorController = {
  /** Begin a recording session. Captured subscriptions are tracked until {@link stop}. */
  start(): void;

  /** End the current session and POST the report to the dashboard. */
  stop(): Promise<void>;

  /**
   * Force a route boundary in the recorder. The detector tracks navigations
   * automatically via the History API; call this if your router bypasses it
   * (rare).
   */
  markNavigation(): void;

  /** Whether {@link start} has been called and {@link stop} has not. */
  readonly isRecording: boolean;

  /**
   * Tear down the patch and the widget. After this the page must reload before
   * `enableRxjsLeakDetector` will work again. Useful in tests; rarely needed in apps.
   */
  teardown(): void;
};

/**
 * Patch `Observable.prototype.subscribe`, mount the floating widget, and return
 * a controller. Calling twice in the same page is a no-op (the original
 * controller is returned).
 *
 * Pass your application's `Observable` class — the one from your `rxjs` import.
 * Do **not** call this in production builds.
 */
export function enableRxjsLeakDetector(
  ObservableCtor: PatchableObservable,
  config: EnableConfig = {},
): LeakDetectorController | null {
  if (config.enabled === false) return null;

  const existing = (globalThis as Record<string, unknown>)[CONTROLLER_GLOBAL_KEY] as
    | LeakDetectorController
    | undefined;
  if (existing) return existing;

  const dashboardUrl = config.dashboardUrl ?? 'http://localhost:7654';
  const recorder = createRecorder();
  installPatch(ObservableCtor, recorder);
  let emitter: LiveEmitter | null = null;

  const stopRouteTracker = installRouteTracker((change) => {
    recorder.recordNavigation(change);
    emitter?.drainNow();
  });

  let widget: WidgetController | null = null;

  const controller: LeakDetectorController = {
    get isRecording() {
      return recorder.isRecording;
    },
    start() {
      recorder.start();
      widget?.setRecording(true);
      emitter = startLiveEmitter({
        recorder,
        dashboardUrl,
        recordingId: recorder.currentRecordingId!,
        initialRoute: recorder.initialRoute,
        startedAtMs: recorder.startedAtMs,
        widget,
      });
    },
    async stop() {
      emitter?.stop();
      emitter = null;
      const report = recorder.stop();
      widget?.setRecording(false);
      await sendReport(report, dashboardUrl);
    },
    markNavigation() {
      recorder.markNavigation();
    },
    teardown() {
      stopRouteTracker();
      widget?.unmount();
      delete (globalThis as Record<string, unknown>)[CONTROLLER_GLOBAL_KEY];
    },
  };

  if (!config.disableWidget) {
    widget = mountWidget({
      onStart: () => controller.start(),
      onStop: () => void controller.stop(),
    });
  }

  (globalThis as Record<string, unknown>)[CONTROLLER_GLOBAL_KEY] = controller;

  // Best-effort: drain reports queued by a previous page-load that couldn't reach the dashboard.
  void flushQueue(dashboardUrl);

  return controller;
}
