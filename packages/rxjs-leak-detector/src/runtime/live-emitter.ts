import type { Recorder } from './recorder.js';
import type { WidgetController } from './widget.js';

const HEARTBEAT_MS = 2000;

export type LiveEmitter = {
  /** Drain any pending changes and push them now (also called on navigation). */
  drainNow(): void;
  /** Stop the heartbeat. Does not POST a final report — that stays in controller.stop. */
  stop(): void;
};

export function startLiveEmitter(args: {
  recorder: Recorder;
  dashboardUrl: string;
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
  widget: WidgetController | null;
}): LiveEmitter {
  const { recorder, dashboardUrl, recordingId, initialRoute, startedAtMs, widget } = args;

  void post(`${dashboardUrl}/session/start`, { recordingId, initialRoute, startedAtMs });

  const drainNow = () => {
    if (!recorder.isRecording) return;
    const delta = recorder.drainDelta();
    void post(`${dashboardUrl}/session/${recordingId}/delta`, delta);
    widget?.setLeakCount(recorder.liveCandidateCount());
  };

  const timer = setInterval(drainNow, HEARTBEAT_MS);

  return {
    drainNow,
    stop() { clearInterval(timer); },
  };
}

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Dashboard may be closed — live streaming is best-effort. Recording
    // integrity depends only on the final /report POST in controller.stop.
  }
}
