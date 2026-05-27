import { describe, it, expect, beforeEach } from 'vitest';
import type { LeakReport } from '@rld/analyzer-core';
import '../src/components/leak-list.js';

const sampleReport: LeakReport = {
  totalSubscriptionsScanned: 1,
  ignoredFrameworkSubscriptions: 0,
  longLivedServiceSubscriptions: [],
  leaks: [
    {
      id: 'sub-1',
      route: '/products',
      observableKind: 'interval',
      sourceLocation: { file: 'src/app/products.component.ts', line: 47, column: 4 },
      componentName: 'ProductListComponent',
      stack: [
        { rawFrame: '', file: 'src/app/products.component.ts', line: 47, column: 4, isFramework: false, functionName: 'ngOnInit' },
      ],
      retainerChain: [
        { nodeId: 1, constructorName: 'ProductListComponent', displayName: 'ProductListComponent' },
      ],
    },
  ],
};

describe('<leak-list>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders one row per leak', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const rows = el.shadowRoot.querySelectorAll('leak-row');
    expect(rows.length).toBe(1);
  });

  it('shows file:line and component in row', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const row = el.shadowRoot.querySelector('leak-row') as any;
    await row.updateComplete;
    expect(row.shadowRoot.textContent).toContain('products.component.ts:47');
    expect(row.shadowRoot.textContent).toContain('ProductListComponent');
    expect(row.shadowRoot.textContent).toContain('interval');
  });

  it('expands to show detail on row click', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const row = el.shadowRoot.querySelector('leak-row') as any;
    await row.updateComplete;
    row.shadowRoot.querySelector('.summary')!.click();
    await row.updateComplete;
    expect(row.shadowRoot.querySelector('leak-detail')).toBeTruthy();
  });
});
