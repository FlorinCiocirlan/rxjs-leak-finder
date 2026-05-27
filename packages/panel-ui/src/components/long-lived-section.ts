import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LongLivedEntry } from '@rld/analyzer-core';

@customElement('long-lived-section')
export class LongLivedSection extends LitElement {
  @property({ type: Array }) entries: LongLivedEntry[] = [];
  @state() private expanded = false;

  static styles = css`
    :host { display: block; margin-top: 16px; border-top: 1px solid #3c4043; }
    h3 { font-size: 11px; color: #9aa0a6; cursor: pointer; padding: 6px 0; margin: 0; }
    .row { padding: 4px 8px; color: #e8eaed; }
  `;

  render() {
    if (this.entries.length === 0) return html``;
    return html`
      <div>
        <h3 @click=${() => { this.expanded = !this.expanded; }}>
          ${this.expanded ? '▼' : '▶'} ${this.entries.length} long-lived (not leaks)
        </h3>
        ${this.expanded ? html`<div>${this.entries.map((e) => html`
          <div class="row">${e.componentName ?? '(unknown)'} · ${e.observableKind}</div>
        `)}</div>` : ''}
      </div>
    `;
  }
}
