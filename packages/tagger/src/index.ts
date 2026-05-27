import { installPatch } from './patch-rxjs.js';
import { createRecordingApi } from './recording-state.js';
import { installRouteTracker, tryAngularRouter } from './route-tracker.js';

declare global {
  interface Window {
    __rxjsLeakDetector?: ReturnType<typeof createRecordingApi> & { _routeStop?: () => void };
  }
}

void installPatch();
const api = createRecordingApi();
const stop = installRouteTracker((change) => api.recordNavigation(change));
void tryAngularRouter((change) => api.recordNavigation(change));
(api as any)._routeStop = stop;
(window as Window).__rxjsLeakDetector = api;

const SOURCE = 'rxjs-leak-detector';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; replyTo?: string };
  if (data?.source !== SOURCE) return;
  if (data.type === 'START_RECORDING') {
    api.start();
  } else if (data.type === 'STOP_RECORDING' && data.replyTo) {
    const meta = api.stop();
    window.postMessage({ source: SOURCE, type: 'RECORDING_META_REPLY', payload: meta, replyTo: data.replyTo }, '*');
  } else if (data.type === 'MARK_NAVIGATION') {
    api.markNavigation();
  }
});

window.postMessage({ source: SOURCE, type: 'TAGGER_READY' }, '*');
