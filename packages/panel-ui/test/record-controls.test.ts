import { describe, it, expect, beforeEach } from 'vitest';
import '../src/components/record-controls.js';

describe('<record-controls>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows Record button when not recording', async () => {
    const el = document.createElement('record-controls') as any;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Record');
  });

  it('dispatches rld-start on Record click', async () => {
    const el = document.createElement('record-controls') as any;
    document.body.append(el);
    await el.updateComplete;
    let fired = false;
    document.addEventListener('rld-start', () => { fired = true; }, { once: true });
    el.shadowRoot.querySelector('button[data-action="start"]')!.click();
    expect(fired).toBe(true);
  });

  it('shows Stop and Mark Nav buttons when recording', async () => {
    const el = document.createElement('record-controls') as any;
    el.isRecording = true;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Stop');
    expect(el.shadowRoot.textContent).toContain('Mark Navigation');
  });

  it('dispatches rld-stop on Stop click', async () => {
    const el = document.createElement('record-controls') as any;
    el.isRecording = true;
    document.body.append(el);
    await el.updateComplete;
    let fired = false;
    document.addEventListener('rld-stop', () => { fired = true; }, { once: true });
    el.shadowRoot.querySelector('button[data-action="stop"]')!.click();
    expect(fired).toBe(true);
  });
});
