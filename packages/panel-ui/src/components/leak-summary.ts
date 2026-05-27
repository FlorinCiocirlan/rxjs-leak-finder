import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakReport } from '@rld/analyzer-core';

@customElement('leak-summary')
export class LeakSummary extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;

  static styles = css`
    :host { display: block; padding: 8px 0; color: #9aa0a6; }
    .leak-count { color: #f28b82; font-weight: 600; }
  `;

  render() {
    if (!this.report) return html``;
    return html`
      <span class="leak-count">${this.report.leaks.length} leak${this.report.leaks.length === 1 ? '' : 's'}</span>
      · ${this.report.ignoredFrameworkSubscriptions} framework subscriptions ignored
      · ${this.report.longLivedServiceSubscriptions.length} long-lived
      · ${this.report.totalSubscriptionsScanned} scanned
    `;
  }
}
