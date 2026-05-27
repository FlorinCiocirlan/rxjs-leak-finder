// TODO: re-enable when Phase 4 adds @rld/panel-ui:
// import '@rld/panel-ui';
import type { PanelToBackground, BackgroundToPanel } from './messages.js';

const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: `panel:${tabId}` });

port.onMessage.addListener((msg: BackgroundToPanel) => {
  const root = document.querySelector('leak-detector-root') as any;
  if (!root) return;
  if (msg.type === 'REPORT_READY') root.report = msg.report;
  else if (msg.type === 'STATE') root.isRecording = msg.isRecording;
  else if (msg.type === 'ERROR') root.error = msg.message;
  else if (msg.type === 'PROGRESS') root.progressPhase = msg.phase;
});

(window as any).__rldSend = (msg: PanelToBackground) => port.postMessage(msg);

document.addEventListener('rld-start', () => port.postMessage({ type: 'START_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-stop', () => port.postMessage({ type: 'STOP_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-mark', () => port.postMessage({ type: 'MARK_NAVIGATION', tabId } as PanelToBackground));
document.addEventListener('rld-open-source', (e: Event) => {
  const detail = (e as CustomEvent).detail as { file: string; line: number; column: number };
  chrome.devtools.panels.openResource(detail.file, detail.line, () => {});
});

port.postMessage({ type: 'QUERY_STATE', tabId } as PanelToBackground);
