import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountWidget } from '../../src/runtime/widget.js';

function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
}

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
});
