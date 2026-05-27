import { installPatch } from './patch.js';
import { createRecorder } from './recorder.js';
import { installRouteTracker } from './route-tracker.js';
import { mountWidget, type WidgetController } from './widget.js';
import { sendReport, flushQueue } from './transport.js';
import type { EnableConfig } from './types.js';

export type LeakDetectorController = {
  start(): void;
  stop(): Promise<void>;
  markNavigation(): void;
  readonly isRecording: boolean;
};

export function enableRxjsLeakDetector(
  ObservableCtor: any,
  config: EnableConfig = {},
): LeakDetectorController | null {
  const existing = (globalThis as any).__rldController as LeakDetectorController | undefined;
  if (existing) return existing;
  if (config.enabled === false) return null;

  const dashboardUrl = config.dashboardUrl ?? 'http://localhost:7654';
  const recorder = createRecorder();
  installPatch(ObservableCtor, recorder);
  const routeStop = installRouteTracker(change => recorder.recordNavigation(change));

  let widget: WidgetController | null = null;

  const controller: LeakDetectorController = {
    get isRecording() { return recorder.isRecording; },
    start() {
      recorder.start();
      widget?.setRecording(true);
    },
    async stop() {
      const report = recorder.stop();
      widget?.setRecording(false);
      await sendReport(report, dashboardUrl);
    },
    markNavigation() {
      recorder.markNavigation();
    },
  };

  if (!config.disableWidget) {
    widget = mountWidget({
      onStart: () => controller.start(),
      onStop: () => void controller.stop(),
      onMark: () => controller.markNavigation(),
    });
  }

  (window as any).__rldController = controller;

  // Best-effort: flush any queued reports from a prior session
  void flushQueue(dashboardUrl);

  // Persist routeStop in case caller wants to tear down (rarely needed)
  (controller as any)._teardown = () => {
    routeStop();
    widget?.unmount();
    delete (window as any).__rldController;
  };

  return controller;
}
