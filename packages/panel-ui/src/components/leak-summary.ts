import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakReport, LeakEntry } from '@rld/analyzer-core';

function tally<T extends string>(items: LeakEntry[], key: (l: LeakEntry) => T | null | undefined): Array<[T, number]> {
  const m = new Map<T, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

@customElement('leak-summary')
export class LeakSummary extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;

  static styles = css`
    :host {
      display: block;
      padding: 8px 0 12px;
      color: #e8eaed;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .kpi {
      background: #3c4043;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .kpi .value { font-size: 20px; font-weight: 600; }
    .kpi .label { font-size: 11px; color: #9aa0a6; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi.leaks .value { color: #f28b82; }
    .kpi.clean .value { color: #81c995; }

    .breakdowns {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
    }
    @media (max-width: 720px) {
      .breakdowns { grid-template-columns: 1fr; }
    }
    .block {
      background: #2d2e30;
      border: 1px solid #3c4043;
      border-radius: 6px;
      padding: 8px;
    }
    .block h4 {
      margin: 0 0 6px;
      font-size: 11px;
      color: #9aa0a6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      font-size: 12px;
    }
    .name { color: #e8eaed; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count {
      background: #5f6368;
      color: #fff;
      border-radius: 9px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 600;
      min-width: 22px;
      text-align: center;
    }
    .empty { color: #5f6368; font-style: italic; font-size: 12px; }
  `;

  private renderBreakdown(title: string, items: Array<[string, number]>) {
    return html`
      <div class="block">
        <h4>${title}</h4>
        ${items.length === 0
          ? html`<div class="empty">none</div>`
          : items.slice(0, 6).map(
              ([k, n]) => html`
                <div class="row">
                  <span class="name" title="${k}">${k}</span>
                  <span class="count">${n}</span>
                </div>
              `,
            )}
      </div>
    `;
  }

  render() {
    if (!this.report) return html``;
    const r = this.report;
    const byKind = tally(r.leaks, (l) => l.leakKind ?? 'unknown');
    const byRoute = tally(r.leaks, (l) => l.route);
    const byComponent = tally(r.leaks, (l) => l.componentName);
    const isClean = r.leaks.length === 0;

    return html`
      <div class="kpis">
        <div class="kpi ${isClean ? 'clean' : 'leaks'}">
          <span class="value">${r.leaks.length}</span>
          <span class="label">${isClean ? 'no leaks' : r.leaks.length === 1 ? 'leak' : 'leaks'}</span>
        </div>
        <div class="kpi">
          <span class="value">${r.totalSubscriptionsScanned}</span>
          <span class="label">scanned</span>
        </div>
        <div class="kpi">
          <span class="value">${r.ignoredFrameworkSubscriptions}</span>
          <span class="label">framework</span>
        </div>
        <div class="kpi">
          <span class="value">${r.longLivedServiceSubscriptions.length}</span>
          <span class="label">long-lived</span>
        </div>
      </div>
      <div class="breakdowns">
        ${this.renderBreakdown('By kind', byKind)}
        ${this.renderBreakdown('By route', byRoute)}
        ${this.renderBreakdown('By component', byComponent)}
      </div>
    `;
  }
}
