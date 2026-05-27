import { describe, it, expectTypeOf } from 'vitest';
import type {
  PanelToBackground,
  BackgroundToPanel,
  BackgroundToContent,
  ContentToBackground,
} from '../src/messages.js';

describe('message types', () => {
  it('PanelToBackground is a discriminated union with expected variants', () => {
    expectTypeOf<PanelToBackground>().toMatchTypeOf<
      | { type: 'START_RECORDING'; tabId: number }
      | { type: 'STOP_RECORDING'; tabId: number }
      | { type: 'MARK_NAVIGATION'; tabId: number }
    >();
  });

  it('BackgroundToPanel has REPORT_READY and error variants', () => {
    expectTypeOf<BackgroundToPanel>().toMatchTypeOf<
      | { type: 'REPORT_READY'; report: unknown }
      | { type: 'ERROR'; message: string }
      | { type: 'STATE'; isRecording: boolean }
    >();
  });
});
