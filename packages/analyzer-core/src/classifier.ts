import type {
  SubscriptionTag,
  ResolvedStackFrame,
  RecordingMeta,
} from './types.js';
import type { ClassificationResult } from './retainer-walker.js';

export type Verdict =
  | 'leak'
  | 'long-lived'
  | 'framework-noise'
  | 'skip-closed'
  | 'skip-different-route'
  | 'skip-different-recording';

export function classify(input: {
  tag: SubscriptionTag;
  frames: ResolvedStackFrame[];
  classification: ClassificationResult;
  recording: RecordingMeta;
}): Verdict {
  const { tag, frames, classification, recording } = input;
  if (tag.closed) return 'skip-closed';
  if (tag.recordingId !== recording.recordingId) return 'skip-different-recording';
  if (tag.route !== recording.initialRoute) return 'skip-different-route';
  const hasUserFrame = frames.some((f) => !f.isFramework);
  if (!hasUserFrame) return 'framework-noise';
  if (classification.reachesApplicationRef && !classification.passesThroughComponent) {
    return 'long-lived';
  }
  return 'leak';
}
