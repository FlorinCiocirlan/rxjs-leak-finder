import { analyze, type LeakReport, type RecordingMeta } from '@rld/analyzer-core';
import { captureHeapSnapshot } from './snapshot-capture.js';
import { fetchSourceMaps } from './source-map-fetcher.js';

type Phase = 'capturing' | 'analyzing' | 'fetching-maps';

type PendingSession = { tabId: number; recordingId: string };

const sessions = new Map<number, PendingSession>();

export async function startRecording(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
  sessions.set(tabId, { tabId, recordingId: '' });
}

export async function stopRecording(
  tabId: number,
  onPhase: (phase: Phase) => void,
): Promise<LeakReport> {
  const meta = await sendAndAwait<RecordingMeta>(tabId, { type: 'STOP_RECORDING' });
  onPhase('capturing');
  const snapshot = await captureHeapSnapshot(tabId);
  onPhase('fetching-maps');
  const scriptUrls = collectUrlsFromSnapshot(snapshot);
  const sourceMaps = await fetchSourceMaps(tabId, scriptUrls);
  onPhase('analyzing');
  const report = await analyze({ snapshot, recording: meta, sourceMaps });
  sessions.delete(tabId);
  return report;
}

function collectUrlsFromSnapshot(snapshot: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"')<>]+\.(?:m?js|ts)/g;
  for (const match of snapshot.matchAll(re)) urls.add(match[0]);
  return [...urls];
}

function sendAndAwait<T>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response as T);
    });
  });
}
