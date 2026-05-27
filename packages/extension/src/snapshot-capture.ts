export async function captureHeapSnapshot(tabId: number): Promise<string> {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  const chunks: string[] = [];
  const onEvent = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => {
    if (source.tabId !== tabId) return;
    if (method === 'HeapProfiler.addHeapSnapshotChunk') {
      const p = params as { chunk: string };
      chunks.push(p.chunk);
    }
  };
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(target, 'HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      captureNumericValue: true,
    });
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await chrome.debugger.detach(target); } catch {}
  }
  return chunks.join('');
}
