import type { PanelToBackground, BackgroundToPanel } from './messages.js';
import { startRecording, stopRecording } from './session.js';

type Port = chrome.runtime.Port;

const panelPorts = new Map<number, Port>(); // tabId -> port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('panel:')) {
    const tabId = Number(port.name.split(':')[1]);
    panelPorts.set(tabId, port);
    port.onDisconnect.addListener(() => panelPorts.delete(tabId));
    port.onMessage.addListener((msg: PanelToBackground) => handlePanelMessage(msg, port));
  }
});

async function handlePanelMessage(msg: PanelToBackground, port: Port): Promise<void> {
  try {
    if (msg.type === 'START_RECORDING') {
      const result = await startRecording(msg.tabId);
      if (!result.ok) {
        send(port, { type: 'ERROR', message: result.warning });
      } else {
        send(port, { type: 'STATE', isRecording: true });
      }
    } else if (msg.type === 'STOP_RECORDING') {
      send(port, { type: 'PROGRESS', phase: 'capturing' });
      const report = await stopRecording(msg.tabId, (phase) =>
        send(port, { type: 'PROGRESS', phase }),
      );
      send(port, { type: 'REPORT_READY', report });
      send(port, { type: 'STATE', isRecording: false });
    } else if (msg.type === 'MARK_NAVIGATION') {
      await chrome.tabs.sendMessage(msg.tabId, { type: 'MARK_NAVIGATION' });
    } else if (msg.type === 'QUERY_STATE') {
      send(port, { type: 'STATE', isRecording: false });
    }
  } catch (err) {
    send(port, { type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
  }
}

function send(port: Port, msg: BackgroundToPanel): void {
  try { port.postMessage(msg); } catch {}
}

chrome.tabs.onRemoved.addListener((tabId) => {
  panelPorts.delete(tabId);
});
