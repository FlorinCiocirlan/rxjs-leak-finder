import type { BackgroundToContent, ContentToBackground } from './messages.js';
import type { RecordingMeta } from '@rld/analyzer-core';

const SOURCE = 'rxjs-leak-detector';
const stopRequests = new Map<string, (value: RecordingMeta) => void>();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; payload?: unknown; replyTo?: string };
  if (data?.source !== SOURCE) return;
  if (data.type === 'TAGGER_READY') {
    chrome.runtime.sendMessage<ContentToBackground>({ type: 'TAGGER_READY' });
    return;
  }
  if (data.type === 'RECORDING_META_REPLY' && data.replyTo) {
    const resolve = stopRequests.get(data.replyTo);
    if (resolve) {
      stopRequests.delete(data.replyTo);
      resolve(data.payload as RecordingMeta);
    }
  }
});

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
  if (msg.type === 'START_RECORDING') {
    window.postMessage({ source: SOURCE, type: 'START_RECORDING' }, '*');
    sendResponse(true);
    return false;
  }
  if (msg.type === 'STOP_RECORDING') {
    const replyId = crypto.randomUUID();
    stopRequests.set(replyId, (meta) => sendResponse(meta));
    window.postMessage({ source: SOURCE, type: 'STOP_RECORDING', replyTo: replyId }, '*');
    return true; // keep channel open for async sendResponse
  }
  if (msg.type === 'MARK_NAVIGATION') {
    window.postMessage({ source: SOURCE, type: 'MARK_NAVIGATION' }, '*');
    sendResponse(true);
    return false;
  }
  return false;
});
