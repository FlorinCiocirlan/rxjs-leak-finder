import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './leak-detail.js';

@customElement('leak-row')
export class LeakRowEl extends LitElement {
  @property({ type: Object }) leak!: LeakEntry;
  @state() private expanded = false;

  static styles = css`
    :host { display: block; border-bottom: 1px solid #3c4043; }
    .summary { padding: 6px 8px; cursor: pointer; display: flex; gap: 12px; align-items: center; }
    .summary:hover { background: #3c4043; }
    .file { color: #8ab4f8; }
    .component { color: #e8eaed; }
    .kind { color: #9aa0a6; font-style: italic; }
  `;

  private toggle = () => { this.expanded = !this.expanded; };

  render() {
    const loc = this.leak.sourceLocation;
    const short = loc.file.split('/').pop();
    return html`
      <div>
        <div class="summary" @click=${this.toggle}>
          <span class="file">${short}:${loc.line}</span>
          <span class="component">${this.leak.componentName ?? '(no component)'}</span>
          <span class="kind">${this.leak.observableKind}</span>
        </div>
        ${this.expanded ? html`<leak-detail .leak=${this.leak}></leak-detail>` : ''}
      </div>
    `;
  }
}
