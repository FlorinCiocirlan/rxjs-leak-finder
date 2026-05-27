import type { LeakReport, RecordingMeta } from '@rld/analyzer-core';

export type PanelToBackground =
  | { type: 'START_RECORDING'; tabId: number }
  | { type: 'STOP_RECORDING'; tabId: number }
  | { type: 'MARK_NAVIGATION'; tabId: number }
  | { type: 'QUERY_STATE'; tabId: number };

export type BackgroundToPanel =
  | { type: 'REPORT_READY'; report: LeakReport }
  | { type: 'ERROR'; message: string }
  | { type: 'STATE'; isRecording: boolean }
  | { type: 'PROGRESS'; phase: 'capturing' | 'analyzing' | 'fetching-maps' };

export type BackgroundToContent =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'MARK_NAVIGATION' };

export type ContentToBackground =
  | { type: 'TAGGER_READY' }
  | { type: 'RECORDING_META'; meta: RecordingMeta };
