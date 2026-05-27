import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ResolvedStackFrame } from '@rld/analyzer-core';

@customElement('stack-frame')
export class StackFrameEl extends LitElement {
  @property({ type: Object }) frame!: ResolvedStackFrame;

  static styles = css`
    :host { display: block; padding: 2px 6px; font-family: inherit; }
    .framework { color: #9aa0a6; }
    a { color: #8ab4f8; cursor: pointer; text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  private open = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('rld-open-source', {
      detail: { file: this.frame.file, line: this.frame.line, column: this.frame.column },
      bubbles: true,
      composed: true,
    }));
  };

  render() {
    const fn = this.frame.functionName ?? '<anon>';
    return html`<div class=${this.frame.isFramework ? 'framework' : ''}>
      ${fn} @ <a @click=${this.open}>${shortName(this.frame.file)}:${this.frame.line}</a>
    </div>`;
  }
}

function shortName(path: string): string {
  return path.split('/').pop() ?? path;
}
