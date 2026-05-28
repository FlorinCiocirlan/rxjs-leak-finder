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
    .summary {
      padding: 8px 10px;
      cursor: pointer;
      display: grid;
      grid-template-columns: auto 1fr auto auto auto;
      gap: 10px;
      align-items: center;
    }
    .summary:hover { background: #3c4043; }
    .caret { color: #9aa0a6; font-size: 10px; width: 10px; }
    .main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .top { display: flex; gap: 8px; align-items: center; min-width: 0; }
    .component { color: #e8eaed; font-weight: 600; white-space: nowrap; }
    .no-component { color: #9aa0a6; font-style: italic; }
    .file { color: #8ab4f8; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .file:hover { text-decoration: underline; }
    .obs-kind { color: #9aa0a6; font-style: italic; font-size: 11px; }
    .badge {
      font-size: 10px;
      padding: 1px 7px;
      border-radius: 8px;
      background: #5f6368;
      color: #fff;
      white-space: nowrap;
    }
    .route { background: #3c4043; color: #aecbfa; border: 1px solid #5f6368; }
    .leak-kind { font-weight: 600; }
    .leak-kind.nested-subscribe { background: #c5221f; }
    .leak-kind.async-init { background: #b06000; }
    .leak-kind.ng-init { background: #1a73e8; }
    .leak-kind.global-event { background: #9334e6; }
    .leak-kind.timer { background: #188038; }
    .leak-kind.subject { background: #0b8043; }
    .leak-kind.unknown { background: #5f6368; }
  `;

  private toggle = () => { this.expanded = !this.expanded; };

  private openSource = (e: Event) => {
    e.stopPropagation();
    const loc = this.leak.sourceLocation;
    this.dispatchEvent(new CustomEvent('rld-open-source', {
      detail: { file: loc.file, line: loc.line, column: loc.column },
      bubbles: true,
      composed: true,
    }));
  };

  render() {
    const loc = this.leak.sourceLocation;
    const short = loc.file.split('/').pop();
    const kind = this.leak.leakKind ?? 'unknown';
    return html`
      <div>
        <div class="summary" @click=${this.toggle}>
          <span class="caret">${this.expanded ? '▼' : '▶'}</span>
          <div class="main">
            <div class="top">
              ${this.leak.componentName
                ? html`<span class="component">${this.leak.componentName}</span>`
                : html`<span class="no-component">(no component)</span>`}
              <span class="obs-kind">${this.leak.observableKind}</span>
            </div>
            <div class="file" title="Open ${loc.file}:${loc.line} in editor" @click=${this.openSource}>${short}:${loc.line}:${loc.column}</div>
          </div>
          <span class="badge route" title="Route at subscribe time">${this.leak.route || '/'}</span>
          <span class="badge leak-kind ${kind}">${kind}</span>
        </div>
        ${this.expanded ? html`<leak-detail .leak=${this.leak}></leak-detail>` : ''}
      </div>
    `;
  }
}
