import type { RawSourceMap } from 'source-map';
import { parseHeapSnapshot } from './heap-parser.js';
import { findSubscriptions } from './subscription-finder.js';
import { decodeTag } from './tag-decoder.js';
import { resolveStack } from './source-map-resolver.js';
import { walkClassification, walkDisplayChain } from './retainer-walker.js';
import { classify } from './classifier.js';
import type {
  RecordingMeta,
  LeakReport,
  LeakEntry,
  LongLivedEntry,
} from './types.js';

export async function analyze(input: {
  snapshot: string;
  recording: RecordingMeta;
  sourceMaps: Map<string, RawSourceMap>;
}): Promise<LeakReport> {
  const { snapshot, recording, sourceMaps } = input;
  const graph = parseHeapSnapshot(snapshot);
  const subs = findSubscriptions(graph);

  const leaks: LeakEntry[] = [];
  const longLived: LongLivedEntry[] = [];
  let ignored = 0;
  let scanned = 0;

  for (const sub of subs) {
    if (sub.metaNodeIndex === null) continue;
    const tag = decodeTag(graph, sub.metaNodeIndex);
    if (!tag) continue;
    if (tag.recordingId !== recording.recordingId) continue;
    scanned++;

    const frames = await resolveStack(tag.stackRaw, sourceMaps);
    const classification = walkClassification(graph, sub.nodeIndex);
    const verdict = classify({ tag, frames, classification, recording });

    if (verdict === 'framework-noise') {
      ignored++;
      continue;
    }
    if (verdict === 'leak') {
      const retainerChain = walkDisplayChain(graph, sub.nodeIndex);
      const componentName = retainerChain.find((n) =>
        n.constructorName.endsWith('Component') || n.constructorName.endsWith('Directive'),
      )?.constructorName ?? null;
      const topUserFrame = frames.find((f) => !f.isFramework);
      const sourceLocation = topUserFrame
        ? { file: topUserFrame.file, line: topUserFrame.line, column: topUserFrame.column }
        : { file: 'unknown', line: 0, column: 0 };
      leaks.push({
        id: tag.id,
        route: tag.route,
        observableKind: tag.observableKind,
        sourceLocation,
        componentName,
        stack: frames,
        retainerChain,
      });
      continue;
    }
    if (verdict === 'long-lived') {
      const retainerChain = walkDisplayChain(graph, sub.nodeIndex);
      const componentName = retainerChain.find((n) =>
        n.constructorName.endsWith('Service'),
      )?.constructorName ?? null;
      const topUserFrame = frames.find((f) => !f.isFramework);
      longLived.push({
        id: tag.id,
        route: tag.route,
        observableKind: tag.observableKind,
        componentName,
        sourceLocation: topUserFrame
          ? { file: topUserFrame.file, line: topUserFrame.line, column: topUserFrame.column }
          : null,
      });
    }
  }

  return {
    leaks,
    ignoredFrameworkSubscriptions: ignored,
    longLivedServiceSubscriptions: longLived,
    totalSubscriptionsScanned: scanned,
  };
}
