import { describe, it, expect, beforeEach } from 'vitest';
import type { LeakEntry } from '@rld/analyzer-core';
import '../src/components/leak-list.js';

const leaks: LeakEntry[] = [
  {
    id: 'sub-1',
    route: '/products',
    observableKind: 'interval',
    sourceLocation: { file: 'src/app/products.component.ts', line: 47, column: 4 },
    componentName: 'ProductListComponent',
    stack: [],
    retainerChain: [],
  },
  {
    id: 'sub-2',
    route: '/cart',
    observableKind: 'fromEvent',
    sourceLocation: { file: 'src/app/cart.component.ts', line: 12, column: 2 },
    componentName: 'CartComponent',
    stack: [],
    retainerChain: [],
  },
];

describe('<leak-list>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (!('IntersectionObserver' in globalThis)) {
      (globalThis as any).IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      };
    }
  });

  it('binds all leaks to the virtualizer', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = leaks;
    document.body.append(el);
    await el.updateComplete;
    const virt = el.shadowRoot.querySelector('lit-virtualizer') as any;
    expect(virt).toBeTruthy();
    expect(virt.items.length).toBe(2);
  });

  it('shows "No matches." when there are no leaks', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = [];
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('lit-virtualizer')).toBeNull();
    expect(el.shadowRoot.textContent).toContain('No matches.');
  });

  it('reports the filtered count in the results meta', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = leaks;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.results-meta')!.textContent).toContain('Showing 2 of 2');
  });
});
