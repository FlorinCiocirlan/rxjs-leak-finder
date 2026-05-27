import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './leak-row.js';

@customElement('leak-list')
export class LeakListEl extends LitElement {
  @property({ type: Array }) leaks: LeakEntry[] = [];

  static styles = css`
    :host { display: block; }
  `;

  render() {
    return html`<div>${this.leaks.map((l) => html`<leak-row .leak=${l}></leak-row>`)}</div>`;
  }
}
