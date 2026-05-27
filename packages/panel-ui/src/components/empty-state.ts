import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('empty-state')
export class EmptyState extends LitElement {
  @property() message = 'Click Record, navigate to a different page in your app, then Stop.';

  static styles = css`
    :host { display: block; padding: 40px 20px; text-align: center; color: #9aa0a6; }
  `;

  render() {
    return html`<div>${this.message}</div>`;
  }
}
