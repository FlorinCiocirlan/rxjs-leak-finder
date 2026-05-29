import { describe, it, expect, beforeEach } from 'vitest';
import type { LeakEntry } from '@rld/analyzer-core';
import '../src/components/leak-row.js';

const sampleLeak: LeakEntry = {
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
};

describe('<leak-row>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows file:line, component and observable kind', async () => {
    const row = document.createElement('leak-row') as any;
    row.leak = sampleLeak;
    document.body.append(row);
    await row.updateComplete;
    expect(row.shadowRoot.textContent).toContain('products.component.ts:47');
    expect(row.shadowRoot.textContent).toContain('ProductListComponent');
    expect(row.shadowRoot.textContent).toContain('interval');
  });

  it('expands to show detail on click', async () => {
    const row = document.createElement('leak-row') as any;
    row.leak = sampleLeak;
    document.body.append(row);
    await row.updateComplete;
    row.shadowRoot.querySelector('.summary')!.click();
    await row.updateComplete;
    expect(row.shadowRoot.querySelector('leak-detail')).toBeTruthy();
  });
});
