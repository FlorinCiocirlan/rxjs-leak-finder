import { describe, it, expect, beforeEach } from 'vitest';
import '../src/components/leak-detector-root.js';

describe('<leak-detector-root>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders empty-state initially', async () => {
    const el = document.createElement('leak-detector-root') as any;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('empty-state')).toBeTruthy();
  });

  it('renders error banner when error is set', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.error = 'Boom';
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Boom');
  });

  it('renders leak-list when report has leaks', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.report = {
      totalSubscriptionsScanned: 1,
      ignoredFrameworkSubscriptions: 0,
      longLivedServiceSubscriptions: [],
      leaks: [{
        id: 'a', route: '/', observableKind: 'interval',
        sourceLocation: { file: 'src/x.ts', line: 1, column: 1 },
        componentName: 'XComponent',
        stack: [], retainerChain: [],
      }],
    };
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('leak-list')).toBeTruthy();
  });
});
