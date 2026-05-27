import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('record-controls')
export class RecordControls extends LitElement {
  @property({ type: Boolean }) isRecording = false;

  static styles = css`
    :host { display: flex; gap: 6px; align-items: center; padding: 4px 0; }
    button { background: #3c4043; color: #e8eaed; border: 1px solid #5f6368; padding: 4px 10px; cursor: pointer; font: inherit; }
    button[data-recording] { background: #f28b82; color: #202124; }
  `;

  private start = () => this.dispatchEvent(new CustomEvent('rld-start', { bubbles: true, composed: true }));
  private stop = () => this.dispatchEvent(new CustomEvent('rld-stop', { bubbles: true, composed: true }));
  private mark = () => this.dispatchEvent(new CustomEvent('rld-mark', { bubbles: true, composed: true }));

  render() {
    if (!this.isRecording) {
      return html`<button data-action="start" @click=${this.start}>● Record</button>`;
    }
    return html`
      <button data-action="stop" data-recording @click=${this.stop}>■ Stop</button>
      <button data-action="mark" @click=${this.mark}>Mark Navigation</button>
    `;
  }
}
