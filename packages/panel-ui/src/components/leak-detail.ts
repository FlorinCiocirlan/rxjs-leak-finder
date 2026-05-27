import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './stack-frame.js';

@customElement('leak-detail')
export class LeakDetailEl extends LitElement {
  @property({ type: Object }) leak!: LeakEntry;

  static styles = css`
    :host { display: block; padding: 8px; background: #1f1f1f; border-left: 2px solid #8ab4f8; }
    h4 { margin: 0 0 4px; font-size: 11px; color: #9aa0a6; text-transform: uppercase; }
    .section { margin-bottom: 10px; }
    .retainer { color: #e8eaed; }
    .retainer span + span::before { content: ' → '; color: #9aa0a6; }
  `;

  render() {
    return html`
      <div class="section">
        <h4>Observable</h4>
        ${this.leak.observableKind}
      </div>
      <div class="section">
        <h4>Stack</h4>
        ${this.leak.stack.map((f) => html`<stack-frame .frame=${f}></stack-frame>`)}
      </div>
      <div class="section">
        <h4>Retainer chain</h4>
        <div class="retainer">
          ${this.leak.retainerChain.map((n) => html`<span>${n.constructorName}</span>`)}
        </div>
      </div>
    `;
  }
}
