import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountWidget } from '../../src/runtime/widget.js';

function pointer(type: string, x: number, y: number, pointerId = 1) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  // MouseEvent has no pointerId; the widget feature-detects it before capturing.
  Object.defineProperty(e, 'pointerId', { value: pointerId, configurable: true });
  return e;
}

// happy-dom lacks pointer capture; install spies so we can observe WHEN the
// widget captures the pointer (it must not capture on a plain press, or the
// synthesized click retargets off the button and recording never starts).
let captureCalls: number[];
beforeEach(() => {
  captureCalls = [];
  (HTMLElement.prototype as any).setPointerCapture = (id: number) => { captureCalls.push(id); };
  (HTMLElement.prototype as any).releasePointerCapture = () => {};
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountWidget', () => {
  it('injects a fixed-position widget element', () => {
    mountWidget({ onStart: () => {}, onStop: () => {} });
    const el = document.getElementById('__rld_widget');
    expect(el).toBeTruthy();
    expect(el!.style.position).toBe('fixed');
  });

  it('starts in idle state showing Rec button', () => {
    mountWidget({ onStart: () => {}, onStop: () => {} });
    const btn = document.querySelector('#__rld_widget button[data-action="start"]');
    expect(btn?.textContent).toContain('Rec');
  });

  it('calls onStart when Rec button clicked', () => {
    const onStart = vi.fn();
    mountWidget({ onStart, onStop: () => {} });
    (document.querySelector('#__rld_widget button[data-action="start"]') as HTMLElement).click();
    expect(onStart).toHaveBeenCalled();
  });

  it('setRecording(true) swaps to Stop button', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    controller.setRecording(true);
    expect(document.querySelector('#__rld_widget button[data-action="stop"]')).toBeTruthy();
  });

  it('calls onStop when Stop button clicked', () => {
    const onStop = vi.fn();
    const controller = mountWidget({ onStart: () => {}, onStop });
    controller.setRecording(true);
    (document.querySelector('#__rld_widget button[data-action="stop"]') as HTMLElement).click();
    expect(onStop).toHaveBeenCalled();
  });

  it('does not render a Mark Nav button when recording', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    controller.setRecording(true);
    expect(document.querySelector('#__rld_widget button[data-action="mark"]')).toBeNull();
    expect(document.getElementById('__rld_widget')!.textContent).not.toContain('Mark Nav');
  });

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

  it('does not capture the pointer on press, so a plain click reaches the button', () => {
    const onStart = vi.fn();
    mountWidget({ onStart, onStop: () => {} });
    const root = document.getElementById('__rld_widget')!;
    const btn = document.querySelector('#__rld_widget button[data-action="start"]') as HTMLElement;

    // Pressing must NOT capture the pointer — capturing on pointerdown makes the
    // browser dispatch the trailing click to the captured root instead of the
    // button, so the button handler never fires (regression: dead Rec button).
    root.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(captureCalls).toEqual([]);

    root.dispatchEvent(pointer('pointerup', 100, 100));
    btn.dispatchEvent(pointer('click', 100, 100));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('captures the pointer only once a drag crosses the threshold', () => {
    mountWidget({ onStart: () => {}, onStop: () => {} });
    const root = document.getElementById('__rld_widget')!;
    root.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(captureCalls).toEqual([]);
    root.dispatchEvent(pointer('pointermove', 160, 140));
    expect(captureCalls).toEqual([1]);
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

  it('exposes setLeakCount and shows the count while recording', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    controller.setRecording(true);
    controller.setLeakCount(3);
    const widget = document.getElementById('__rld_widget')!;
    expect(widget.textContent).toContain('3');
    expect(widget.querySelector('button[data-action="stop"]')).toBeTruthy();
  });

  it('setLeakCount before recording does not throw and shows nothing live', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    expect(() => controller.setLeakCount(5)).not.toThrow();
    expect(document.querySelector('#__rld_widget button[data-action="start"]')).toBeTruthy();
  });
});
