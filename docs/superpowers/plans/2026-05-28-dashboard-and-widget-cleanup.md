# Dashboard & Widget Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dashboard recording controls, drop the "Mark Nav" button from both surfaces, make the injected in-page "Rec" widget draggable, and virtualize the leak list so large reports (3500+ leaks) render without DOM bloat.

**Architecture:** Two separate UI surfaces are touched. (1) The DevTools dashboard is a set of Lit web components in `packages/panel-ui`, consumed by `packages/extension`. We delete the `<record-controls>` component entirely and virtualize `<leak-list>` with `@lit-labs/virtualizer`. (2) The injected in-page widget is plain DOM created in `packages/rxjs-leak-detector/src/runtime/widget.ts`; we remove its "Mark Nav" button and add pointer-based dragging.

**Tech Stack:** TypeScript, Lit 3, `@lit-labs/virtualizer` 2.1.1, Vitest + happy-dom, pnpm workspaces.

---

## Background / Current State

- **Dashboard recording UI:** `packages/panel-ui/src/components/record-controls.ts` renders `● Record` (idle) and `■ Stop` + `Mark Navigation` (recording). It dispatches `rld-start` / `rld-stop` / `rld-mark` custom events. It is rendered by `leak-detector-root.ts:32` and exported from `index.ts:2`.
- **Event consumers:** `packages/extension/src/panel.ts:18-20` listens for `rld-start`/`rld-stop`/`rld-mark` and posts messages to the background worker. These listeners are the ONLY thing those events feed; once `record-controls` is gone, nothing dispatches them.
- **Injected widget:** `packages/rxjs-leak-detector/src/runtime/widget.ts` builds a `position:fixed` div pinned to `bottom:12px / right:12px`. It shows `● Rec` (idle) and `■ Stop` + `Mark Nav` (recording). Wired in `enable.ts:84-89` via `mountWidget({ onStart, onStop, onMark })`.
- **Leak list:** `packages/panel-ui/src/components/leak-list.ts:167` renders every filtered leak with `filtered.map((l) => html\`<leak-row .leak=${l}></leak-row>\`)` — no virtualization. Rows expand on click (variable height).

## Decisions (from user)

1. Remove the **entire** `record-controls` component from the dashboard.
2. Remove "Mark Nav" from **both** surfaces (injected widget + dashboard — the latter is covered by removing `record-controls`).
3. Virtualize the leak list using **`@lit-labs/virtualizer`**.

## Scope Notes (read before starting)

- The runtime controller's `markNavigation()` method (`enable.ts:73-75`, `EnableController.markNavigation` interface at `enable.ts:22`, `recorder.markNavigation()`) is a **public API kept intact**. We only remove the *button* and its `onMark` wiring into the widget. Do NOT delete `markNavigation` from the controller/recorder.
- The extension background handlers for `START_RECORDING` / `STOP_RECORDING` / `MARK_NAVIGATION` (`packages/extension/src/background.ts`) and the `messages.ts` types become unreachable from the panel once the dashboard controls are gone. **Leave them in place** — deleting them is out of scope for this plan. Flag this to the user at the end.

## File Structure (what changes)

- **Delete:** `packages/panel-ui/src/components/record-controls.ts`
- **Delete:** `packages/panel-ui/test/record-controls.test.ts`
- **Modify:** `packages/panel-ui/src/index.ts` (drop export)
- **Modify:** `packages/panel-ui/src/components/leak-detector-root.ts` (drop import, usage, `isRecording` property)
- **Modify:** `packages/panel-ui/test/leak-detector-root.test.ts` (add regression test)
- **Modify:** `packages/extension/src/panel.ts` (drop dead `rld-*` listeners)
- **Modify:** `packages/rxjs-leak-detector/src/runtime/widget.ts` (remove Mark Nav, add dragging)
- **Modify:** `packages/rxjs-leak-detector/src/runtime/enable.ts` (drop `onMark` from `mountWidget` call)
- **Modify:** `packages/rxjs-leak-detector/test/runtime/widget.test.ts` (drop `onMark`, add drag + no-mark tests)
- **Modify:** `packages/panel-ui/package.json` (add `@lit-labs/virtualizer`)
- **Modify:** `packages/panel-ui/src/components/leak-list.ts` (virtualize)
- **Create:** `packages/panel-ui/test/leak-row.test.ts` (preserve row-content coverage)
- **Modify:** `packages/panel-ui/test/leak-list.test.ts` (assert virtualizer binding)

---

## Task 1: Remove the `record-controls` component from the dashboard

**Files:**
- Modify: `packages/panel-ui/test/leak-detector-root.test.ts`
- Modify: `packages/panel-ui/src/components/leak-detector-root.ts:4,13,32`
- Modify: `packages/panel-ui/src/index.ts:2`
- Delete: `packages/panel-ui/src/components/record-controls.ts`
- Delete: `packages/panel-ui/test/record-controls.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add this test to `packages/panel-ui/test/leak-detector-root.test.ts`, immediately after the existing `renders empty-state initially` test (after its closing `});` near line 12):

```typescript
  it('does not render record-controls', async () => {
    const el = document.createElement('leak-detector-root') as any;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('record-controls')).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rld/panel-ui exec vitest run test/leak-detector-root.test.ts`
Expected: FAIL — the new test fails because `<record-controls>` is currently rendered (assertion expects `null` but finds the element).

- [ ] **Step 3: Remove `record-controls` from `leak-detector-root.ts`**

In `packages/panel-ui/src/components/leak-detector-root.ts`:

Delete the import line (currently line 4):
```typescript
import './record-controls.js';
```

Delete the `isRecording` property (currently line 13):
```typescript
  @property({ type: Boolean }) isRecording = false;
```

In `render()`, delete the `<record-controls>` line (currently line 32) so the `<div>` opens directly onto the error block. The render block becomes:

```typescript
  render() {
    return html`
      <div>
        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        ${this.renderProgress()}
        ${this.report ? html`
          <div>
            <leak-summary .report=${this.report}></leak-summary>
            ${this.report.leaks.length === 0
              ? html`<empty-state message="No leaks detected ✓"></empty-state>`
              : html`<leak-list .leaks=${this.report.leaks}></leak-list>`}
            <long-lived-section .entries=${this.report.longLivedServiceSubscriptions}></long-lived-section>
          </div>
        ` : html`<empty-state></empty-state>`}
      </div>
    `;
  }
```

- [ ] **Step 4: Remove the export from `index.ts`**

In `packages/panel-ui/src/index.ts`, delete this line (currently line 2):
```typescript
export * from './components/record-controls.js';
```

- [ ] **Step 5: Delete the component and its test file**

Run:
```bash
rm packages/panel-ui/src/components/record-controls.ts packages/panel-ui/test/record-controls.test.ts
```

- [ ] **Step 6: Run the panel-ui test suite + typecheck**

Run: `pnpm --filter @rld/panel-ui test && pnpm --filter @rld/panel-ui run typecheck`
Expected: PASS — all tests green (including the new `does not render record-controls`), no TypeScript errors. The deleted `record-controls.test.ts` no longer runs.

---

## Task 2: Remove dead recording event listeners in the extension panel

**Files:**
- Modify: `packages/extension/src/panel.ts:18-20`

The `rld-start` / `rld-stop` / `rld-mark` events can no longer be dispatched (their only source, `record-controls`, is deleted). Remove the now-dead listeners. Leave the `rld-open-source` listener and everything else untouched.

- [ ] **Step 1: Delete the three dead listeners**

In `packages/extension/src/panel.ts`, delete these three lines (currently lines 18-20):

```typescript
document.addEventListener('rld-start', () => port.postMessage({ type: 'START_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-stop', () => port.postMessage({ type: 'STOP_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-mark', () => port.postMessage({ type: 'MARK_NAVIGATION', tabId } as PanelToBackground));
```

After the edit, the `rld-open-source` listener (currently line 21) follows directly after the `__rldSend` assignment (line 16). Leave the `STATE` branch in the `onMessage` handler as-is.

- [ ] **Step 2: Typecheck the extension**

Run: `pnpm --filter @rld/extension run typecheck`
Expected: PASS — no TypeScript errors. (`PanelToBackground` is still imported and used by `__rldSend` and `QUERY_STATE`, so the import does not become unused.)

- [ ] **Step 3: Run the extension test suite**

Run: `pnpm --filter @rld/extension test`
Expected: PASS — message-type tests are unaffected.

---

## Task 3: Remove the "Mark Nav" button and `onMark` wiring from the injected widget

**Files:**
- Modify: `packages/rxjs-leak-detector/test/runtime/widget.test.ts`
- Modify: `packages/rxjs-leak-detector/src/runtime/widget.ts:6-10,50-59`
- Modify: `packages/rxjs-leak-detector/src/runtime/enable.ts:84-89`

- [ ] **Step 1: Write the failing test for "no Mark Nav button when recording"**

In `packages/rxjs-leak-detector/test/runtime/widget.test.ts`, first update EVERY existing `mountWidget({...})` call to drop the `onMark` property (the callback type will no longer accept it). For example `mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} })` becomes `mountWidget({ onStart: () => {}, onStop: () => {} })`, and `mountWidget({ onStart, onStop: () => {}, onMark: () => {} })` becomes `mountWidget({ onStart, onStop: () => {} })`. Apply to all five existing calls (lines 10, 17, 24, 30, 37).

Then add this new test inside the `describe('mountWidget', ...)` block:

```typescript
  it('does not render a Mark Nav button when recording', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    controller.setRecording(true);
    expect(document.querySelector('#__rld_widget button[data-action="mark"]')).toBeNull();
    expect(document.getElementById('__rld_widget')!.textContent).not.toContain('Mark Nav');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter rxjs-leak-finder exec vitest run test/runtime/widget.test.ts`
Expected: FAIL — the new test fails because the `Mark Nav` button is still rendered when recording. (Type errors on the `onMark` removals are expected too; they resolve in Step 3.)

- [ ] **Step 3: Remove Mark Nav from `widget.ts`**

In `packages/rxjs-leak-detector/src/runtime/widget.ts`, remove `onMark` from the `WidgetCallbacks` type (currently lines 6-10) so it reads:

```typescript
type WidgetCallbacks = {
  onStart(): void;
  onStop(): void;
};
```

In the `render()` function's `if (recording)` branch, delete the entire Mark Nav button block (currently lines 50-59) — the `const mark = ...` through `root.appendChild(mark);`. The recording branch becomes:

```typescript
    if (recording) {
      btn.textContent = '■ Stop';
      btn.dataset.action = 'stop';
      btn.addEventListener('click', () => cb.onStop());
      root.appendChild(btn);
    } else {
```

- [ ] **Step 4: Remove `onMark` from the `enable.ts` widget wiring**

In `packages/rxjs-leak-detector/src/runtime/enable.ts`, the `mountWidget` call (currently lines 84-89) becomes:

```typescript
    widget = mountWidget({
      onStart: () => controller.start(),
      onStop: () => void controller.stop(),
    });
```

Leave `controller.markNavigation` (the method at `enable.ts:73-75` and the `EnableController` interface member at `enable.ts:22`) untouched — it is a kept public API.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter rxjs-leak-finder exec vitest run test/runtime/widget.test.ts && pnpm --filter rxjs-leak-finder run typecheck`
Expected: PASS — `does not render a Mark Nav button when recording` passes, all other widget tests pass, no TypeScript errors.

---

## Task 4: Make the injected widget draggable

**Files:**
- Modify: `packages/rxjs-leak-detector/src/runtime/widget.ts`
- Modify: `packages/rxjs-leak-detector/test/runtime/widget.test.ts`

**Approach:** Attach pointer handlers to the widget root. On `pointerdown` record the start position and the element's current screen position. On `pointermove`, once movement exceeds a small threshold, switch the element from `right/bottom` anchoring to `left/top` and follow the pointer. A drag sets a `moved` flag; a capture-phase `click` handler swallows the click that would otherwise fire the Rec/Stop button, so dragging never accidentally toggles recording. A plain click (no movement) still reaches the button.

- [ ] **Step 1: Write the failing test "dragging moves the widget"**

In `packages/rxjs-leak-detector/test/runtime/widget.test.ts`, add a helper at the top of the file (after the imports) and two tests inside the `describe` block:

```typescript
function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
}
```

```typescript
  it('dragging moves the widget to left/top coordinates', () => {
    mountWidget({ onStart: () => {}, onStop: () => {} });
    const root = document.getElementById('__rld_widget')!;
    root.dispatchEvent(pointer('pointerdown', 100, 100));
    root.dispatchEvent(pointer('pointermove', 160, 140));
    root.dispatchEvent(pointer('pointerup', 160, 140));
    expect(root.style.left).toBe('60px');
    expect(root.style.top).toBe('40px');
    expect(root.style.right).toBe('auto');
    expect(root.style.bottom).toBe('auto');
  });

  it('a drag suppresses the button click but a plain click does not', () => {
    const onStart = vi.fn();
    mountWidget({ onStart, onStop: () => {} });
    const root = document.getElementById('__rld_widget')!;
    const btn = document.querySelector('#__rld_widget button[data-action="start"]') as HTMLElement;

    // Drag, then the trailing click must be swallowed.
    root.dispatchEvent(pointer('pointerdown', 100, 100));
    root.dispatchEvent(pointer('pointermove', 160, 140));
    root.dispatchEvent(pointer('pointerup', 160, 140));
    btn.dispatchEvent(pointer('click', 160, 140));
    expect(onStart).not.toHaveBeenCalled();

    // A subsequent plain click (no drag) still triggers onStart.
    btn.dispatchEvent(pointer('click', 160, 140));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
```

(`getBoundingClientRect()` returns all-zero rects under happy-dom, so the dragged position equals the pointer delta: start `(100,100)` → move `(160,140)` gives `left:60px / top:40px`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter rxjs-leak-finder exec vitest run test/runtime/widget.test.ts`
Expected: FAIL — `root.style.left` is empty (no drag logic yet) and `onStart` IS called after the drag (no click suppression yet).

- [ ] **Step 3: Add the drag behavior to `widget.ts`**

In `packages/rxjs-leak-detector/src/runtime/widget.ts`, add three style properties to the `Object.assign(root.style, {...})` block (after `boxShadow`):

```typescript
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    cursor: 'move',
    touchAction: 'none',
    userSelect: 'none',
```

Then, immediately after that `Object.assign(root.style, {...});` block and before `let recording = false;`, insert the drag logic and the module-level threshold constant. Add the constant at the top of the file (after the type declarations, before `export function mountWidget`):

```typescript
const DRAG_THRESHOLD = 4;
```

Insert inside `mountWidget`, after the root style assignment:

```typescript
  // --- draggable behavior ---
  let pointerStart: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;

  root.addEventListener('pointerdown', (e) => {
    const rect = root.getBoundingClientRect();
    pointerStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    moved = false;
    if (e.pointerId != null && typeof root.setPointerCapture === 'function') {
      root.setPointerCapture(e.pointerId);
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!pointerStart) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    moved = true;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = `${pointerStart.left + dx}px`;
    root.style.top = `${pointerStart.top + dy}px`;
  });

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId != null && typeof root.releasePointerCapture === 'function') {
      root.releasePointerCapture(e.pointerId);
    }
    pointerStart = null;
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Swallow the click that trails a drag so it never toggles recording.
  root.addEventListener(
    'click',
    (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    },
    true,
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter rxjs-leak-finder exec vitest run test/runtime/widget.test.ts`
Expected: PASS — both drag tests pass and all existing widget tests still pass.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter rxjs-leak-finder run typecheck`
Expected: PASS — no TypeScript errors.

---

## Task 5: Add the `@lit-labs/virtualizer` dependency

**Files:**
- Modify: `packages/panel-ui/package.json`

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @rld/panel-ui add @lit-labs/virtualizer@2.1.1
```

- [ ] **Step 2: Verify it installed**

Run: `node -e "console.log(require('./packages/panel-ui/package.json').dependencies['@lit-labs/virtualizer'])"`
Expected: prints a version string starting with `2.1.1` (e.g. `^2.1.1`).

---

## Task 6: Extract leak-row content tests into their own file

**Files:**
- Create: `packages/panel-ui/test/leak-row.test.ts`

**Why:** Once the leak list is virtualized (Task 7), `<leak-row>` elements are no longer rendered synchronously by `<leak-list>` under happy-dom (the virtualizer renders based on viewport measurement, which happy-dom does not perform). The two row-content assertions currently living in `leak-list.test.ts` must move to a dedicated test that instantiates `<leak-row>` directly, preserving coverage independent of the virtualizer.

- [ ] **Step 1: Create the leak-row test file**

Create `packages/panel-ui/test/leak-row.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the new test file**

Run: `pnpm --filter @rld/panel-ui exec vitest run test/leak-row.test.ts`
Expected: PASS — both tests pass (this exercises the existing, unmodified `<leak-row>` component).

---

## Task 7: Virtualize the leak list

**Files:**
- Modify: `packages/panel-ui/src/components/leak-list.ts:1-4,68-69,165-167`
- Modify: `packages/panel-ui/test/leak-list.test.ts`

- [ ] **Step 1: Rewrite the leak-list test to assert virtualizer binding**

Replace the entire contents of `packages/panel-ui/test/leak-list.test.ts` with the following. The new tests assert that the list binds all filtered leaks to a `<lit-virtualizer>` element (the row-content/expand assertions now live in `leak-row.test.ts` from Task 6). An `IntersectionObserver` stub is added because happy-dom does not provide one and `@lit-labs/virtualizer` references it.

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rld/panel-ui exec vitest run test/leak-list.test.ts`
Expected: FAIL — `binds all leaks to the virtualizer` fails because `<lit-virtualizer>` does not exist yet (the list still uses `filtered.map`, so `querySelector('lit-virtualizer')` is `null`).

- [ ] **Step 3: Import the virtualizer in `leak-list.ts`**

In `packages/panel-ui/src/components/leak-list.ts`, add the import after the existing `import './leak-row.js';` (line 4):

```typescript
import './leak-row.js';
import '@lit-labs/virtualizer';
```

- [ ] **Step 4: Add the scroller style**

In `leak-list.ts`, add a `.scroller` rule to the `static styles` css block, immediately before the closing backtick of the `.none` rule (currently line 68). Insert after the `.none { ... }` line:

```typescript
    .none { color: #5f6368; padding: 12px 8px; font-style: italic; }
    .scroller { display: block; max-height: 70vh; overflow: auto; }
```

- [ ] **Step 5: Replace the `.map` render with `<lit-virtualizer>`**

In `leak-list.ts` `render()`, replace the final conditional block (currently lines 165-167):

```typescript
        ${filtered.length === 0
          ? html`<div class="none">No matches.</div>`
          : html`<div>${filtered.map((l) => html`<leak-row .leak=${l}></leak-row>`)}</div>`}
```

with:

```typescript
        ${filtered.length === 0
          ? html`<div class="none">No matches.</div>`
          : html`<lit-virtualizer
              class="scroller"
              .items=${filtered}
              .renderItem=${(l: LeakEntry) => html`<leak-row .leak=${l}></leak-row>`}
            ></lit-virtualizer>`}
```

- [ ] **Step 6: Run the leak-list tests to verify they pass**

Run: `pnpm --filter @rld/panel-ui exec vitest run test/leak-list.test.ts`
Expected: PASS — all three tests pass (`<lit-virtualizer>` is present with `items.length === 2`).

- [ ] **Step 7: Run the full panel-ui suite + typecheck**

Run: `pnpm --filter @rld/panel-ui test && pnpm --filter @rld/panel-ui run typecheck`
Expected: PASS — all panel-ui tests green, no TypeScript errors.

---

## Final Verification

- [ ] **Step 1: Run the full monorepo test suite**

Run: `pnpm test`
Expected: PASS — every package's tests pass.

- [ ] **Step 2: Run the full typecheck**

Run: `pnpm typecheck`
Expected: PASS — no TypeScript errors across packages.

- [ ] **Step 3: Build everything**

Run: `pnpm build`
Expected: SUCCESS — all packages build, including the extension (`vite build`) which bundles `@rld/panel-ui` and its new `@lit-labs/virtualizer` dependency, and `rxjs-leak-finder` (which bundles the dashboard).

- [ ] **Step 4: Confirm leftover dead code with the user**

Report to the user: the extension background handlers for `START_RECORDING` / `STOP_RECORDING` / `MARK_NAVIGATION` (`packages/extension/src/background.ts`) and the corresponding `messages.ts` types are now unreachable from the panel (their only trigger, the dashboard recording controls, was removed). They were intentionally left in place per this plan's scope. Ask whether they should also be removed in a follow-up.

---

## Self-Review Notes

- **Spec coverage:** (1) delete Record button from dashboard → Task 1 (removes entire `record-controls`). (2) make injected Rec button draggable → Task 4. (3) remove Mark Nav → Task 3 (widget) + Task 1 (dashboard, via component removal). (4) virtualize the leak list → Tasks 5–7. All four requirements covered.
- **Type consistency:** `WidgetCallbacks` loses `onMark` in Task 3 and every caller (`enable.ts`, all test literals) is updated in the same task — no stale `onMark` references remain. `mountWidget`'s return type `WidgetController` is unchanged. `markNavigation` on the runtime controller is deliberately retained.
- **happy-dom caveats handled:** `getBoundingClientRect` returns zeros (drag test math accounts for it); `setPointerCapture`/`releasePointerCapture` are feature-detected; `IntersectionObserver` is stubbed for the virtualizer (`ResizeObserver` already exists in happy-dom 14).
- **Test command note:** `rxjs-leak-finder` is the npm package name for the `packages/rxjs-leak-detector/` directory — pnpm `--filter` uses the package name, not the directory name.
