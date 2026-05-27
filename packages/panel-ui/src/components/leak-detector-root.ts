import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakReport } from '@rld/analyzer-core';
import './record-controls.js';
import './leak-list.js';
import './leak-summary.js';
import './long-lived-section.js';
import './empty-state.js';

@customElement('leak-detector-root')
export class LeakDetectorRoot extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;
  @property({ type: Boolean }) isRecording = false;
  @property() error: string | null = null;
  @property() progressPhase: 'capturing' | 'analyzing' | 'fetching-maps' | null = null;

  static styles = css`
    :host { display: block; padding: 8px; font: 12px monospace; color: #e8eaed; background: #2b2b2b; min-height: 100vh; }
    .error { color: #f28b82; padding: 8px; border: 1px solid #f28b82; margin: 8px 0; }
    .progress { color: #8ab4f8; padding: 8px; }
  `;

  private renderProgress() {
    if (!this.progressPhase) return '';
    const messages = { capturing: 'Capturing heap snapshot…', 'fetching-maps': 'Fetching source maps…', analyzing: 'Analyzing…' };
    return html`<div class="progress">${messages[this.progressPhase]}</div>`;
  }

  render() {
    return html`
      <div>
        <record-controls .isRecording=${this.isRecording}></record-controls>
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
}
