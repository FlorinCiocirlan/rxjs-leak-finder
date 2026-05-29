import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakReport, LeakEntry } from '@rld/analyzer-core';
import './leak-list.js';
import './leak-summary.js';
import './long-lived-section.js';
import './empty-state.js';

@customElement('leak-detector-root')
export class LeakDetectorRoot extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;
  @property() error: string | null = null;
  @property() progressPhase: 'capturing' | 'analyzing' | 'fetching-maps' | null = null;
  @property({ type: Boolean }) live = false;
  @property({ type: Array }) liveCandidates: LeakEntry[] = [];

  static styles = css`
    :host { display: block; padding: 8px; font: 12px monospace; color: #e8eaed; background: #2b2b2b; min-height: 100vh; }
    .error { color: #f28b82; padding: 8px; border: 1px solid #f28b82; margin: 8px 0; }
    .progress { color: #8ab4f8; padding: 8px; }
    .live-banner { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #33312b; border-bottom: 1px solid #5f6368; color: #f28b82; font-weight: bold; letter-spacing: .5px; }
    .live-banner .dot { width: 9px; height: 9px; border-radius: 50%; background: #f28b82; animation: rld-pulse 1.4s infinite; }
    @keyframes rld-pulse { 0% { opacity: 1 } 50% { opacity: .3 } 100% { opacity: 1 } }
    .waiting { padding: 48px 16px; text-align: center; color: #8ab4f8; }
    .radar { width: 48px; height: 48px; margin: 0 auto 14px; border: 2px solid #3c4043; border-top-color: #8ab4f8; border-radius: 50%; animation: rld-spin 1s linear infinite; }
    @keyframes rld-spin { to { transform: rotate(360deg) } }
    .waiting .hint { font-size: 11px; color: #9aa0a6; margin-top: 6px; }
  `;

  private renderProgress() {
    if (!this.progressPhase) return '';
    const messages = { capturing: 'Capturing heap snapshot…', 'fetching-maps': 'Fetching source maps…', analyzing: 'Analyzing…' };
    return html`<div class="progress">${messages[this.progressPhase]}</div>`;
  }

  render() {
    if (this.live) {
      return html`
        <div>
          <div class="live-banner"><span class="dot"></span> LIVE — recording</div>
          ${this.liveCandidates.length === 0
            ? html`<div class="waiting">
                <div class="radar"></div>
                <div>Waiting for leaks…</div>
                <div class="hint">Navigate your app. Subscriptions that outlive their route show up here.</div>
              </div>`
            : html`<leak-list .leaks=${this.liveCandidates}></leak-list>`}
        </div>
      `;
    }

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
}
