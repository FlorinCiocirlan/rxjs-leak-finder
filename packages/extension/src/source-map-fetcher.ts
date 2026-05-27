import type { RawSourceMap } from 'source-map';

const FRAME_REGEX = /at\s+(?:.+?\s+\()?(.+?):\d+:\d+\)?$/gm;

export function extractScriptUrls(stack: string): string[] {
  const urls = new Set<string>();
  for (const match of stack.matchAll(FRAME_REGEX)) {
    const url = match[1];
    if (url && /^https?:\/\//.test(url)) urls.add(url);
  }
  return [...urls];
}

export async function fetchSourceMaps(
  tabId: number,
  scriptUrls: string[],
): Promise<Map<string, RawSourceMap>> {
  const result = new Map<string, RawSourceMap>();
  const limit = 6;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < scriptUrls.length) {
      const idx = i++;
      const url = scriptUrls[idx]!;
      try {
        const map = await fetchOne(tabId, url);
        if (map) result.set(url, map);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return result;
}

async function fetchOne(tabId: number, scriptUrl: string): Promise<RawSourceMap | null> {
  void tabId; // unused here; reserved for cross-tab scenarios
  const mapUrl = `${scriptUrl}.map`;
  const expression = `fetch(${JSON.stringify(mapUrl)}).then(r => r.ok ? r.text() : null).catch(() => null)`;
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      if (exceptionInfo || typeof result !== 'string') {
        resolve(null);
        return;
      }
      try { resolve(JSON.parse(result) as RawSourceMap); }
      catch { resolve(null); }
    });
  });
}
