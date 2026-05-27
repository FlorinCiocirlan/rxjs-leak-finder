import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountWidget } from '../../src/runtime/widget.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountWidget', () => {
  it('injects a fixed-position widget element', () => {
    mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    const el = document.getElementById('__rld_widget');
    expect(el).toBeTruthy();
    expect(el!.style.position).toBe('fixed');
  });

  it('starts in idle state showing Rec button', () => {
    mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    const btn = document.querySelector('#__rld_widget button[data-action="start"]');
    expect(btn?.textContent).toContain('Rec');
  });

  it('calls onStart when Rec button clicked', () => {
    const onStart = vi.fn();
    mountWidget({ onStart, onStop: () => {}, onMark: () => {} });
    (document.querySelector('#__rld_widget button[data-action="start"]') as HTMLElement).click();
    expect(onStart).toHaveBeenCalled();
  });

  it('setRecording(true) swaps to Stop button', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    controller.setRecording(true);
    expect(document.querySelector('#__rld_widget button[data-action="stop"]')).toBeTruthy();
  });

  it('calls onStop when Stop button clicked', () => {
    const onStop = vi.fn();
    const controller = mountWidget({ onStart: () => {}, onStop, onMark: () => {} });
    controller.setRecording(true);
    (document.querySelector('#__rld_widget button[data-action="stop"]') as HTMLElement).click();
    expect(onStop).toHaveBeenCalled();
  });
});
