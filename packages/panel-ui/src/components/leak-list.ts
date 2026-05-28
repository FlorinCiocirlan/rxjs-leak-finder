import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './leak-row.js';
import '@lit-labs/virtualizer';

@customElement('leak-list')
export class LeakListEl extends LitElement {
  @property({ type: Array }) leaks: LeakEntry[] = [];
  @state() private query = '';
  @state() private kindFilter: string | null = null;
  @state() private routeFilter: string | null = null;

  static styles = css`
    :host { display: block; margin-top: 4px; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #3c4043;
    }
    input.search {
      flex: 1 1 220px;
      min-width: 200px;
      background: #2d2e30;
      color: #e8eaed;
      border: 1px solid #3c4043;
      border-radius: 4px;
      padding: 4px 8px;
      font: inherit;
      outline: none;
    }
    input.search:focus { border-color: #8ab4f8; }
    .chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .chip {
      background: #3c4043;
      color: #e8eaed;
      border-radius: 12px;
      padding: 2px 9px;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      border: 1px solid transparent;
    }
    .chip:hover { background: #4a4d51; }
    .chip.active {
      background: #8ab4f8;
      color: #202124;
      border-color: #8ab4f8;
    }
    .chip .n { opacity: 0.8; margin-left: 4px; }
    .results-meta {
      color: #9aa0a6;
      font-size: 11px;
      padding: 6px 0;
    }
    .group { margin-top: 10px; }
    .group-header {
      font-size: 11px;
      color: #9aa0a6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 6px 8px;
      background: #2d2e30;
      border-radius: 4px 4px 0 0;
    }
    .none { color: #5f6368; padding: 12px 8px; font-style: italic; }
    .scroller { display: block; max-height: 70vh; overflow: auto; }
  `;

  private tally(key: (l: LeakEntry) => string | null | undefined): Array<[string, number]> {
    const m = new Map<string, number>();
    for (const l of this.leaks) {
      const k = key(l);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  private toggleKind(k: string) {
    this.kindFilter = this.kindFilter === k ? null : k;
  }
  private toggleRoute(r: string) {
    this.routeFilter = this.routeFilter === r ? null : r;
  }
  private onSearch = (e: Event) => {
    this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
  };
  private clear = () => {
    this.query = '';
    this.kindFilter = null;
    this.routeFilter = null;
  };

  private filtered(): LeakEntry[] {
    const q = this.query;
    return this.leaks.filter((l) => {
      if (this.kindFilter && (l.leakKind ?? 'unknown') !== this.kindFilter) return false;
      if (this.routeFilter && l.route !== this.routeFilter) return false;
      if (!q) return true;
      const hay = [
        l.componentName ?? '',
        l.observableKind,
        l.route,
        l.sourceLocation.file,
        l.leakKind ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  render() {
    const byKind = this.tally((l) => l.leakKind ?? 'unknown');
    const byRoute = this.tally((l) => l.route);
    const filtered = this.filtered();
    const hasFilter =
      this.query !== '' || this.kindFilter !== null || this.routeFilter !== null;

    return html`
      <div>
        <div class="toolbar">
          <input
            class="search"
            type="search"
            placeholder="Search component, file, route, kind…"
            .value=${this.query}
            @input=${this.onSearch}
          />
          ${hasFilter
            ? html`<span class="chip" @click=${this.clear} title="Clear filters">✕ clear</span>`
            : ''}
        </div>
        ${byKind.length > 1
          ? html`<div class="toolbar">
              <span style="color:#9aa0a6;font-size:11px">Kind:</span>
              <div class="chips">
                ${byKind.map(
                  ([k, n]) => html`<span
                    class="chip ${this.kindFilter === k ? 'active' : ''}"
                    @click=${() => this.toggleKind(k)}
                  >${k}<span class="n">${n}</span></span>`,
                )}
              </div>
            </div>`
          : ''}
        ${byRoute.length > 1
          ? html`<div class="toolbar">
              <span style="color:#9aa0a6;font-size:11px">Route:</span>
              <div class="chips">
                ${byRoute.map(
                  ([r, n]) => html`<span
                    class="chip ${this.routeFilter === r ? 'active' : ''}"
                    @click=${() => this.toggleRoute(r)}
                  >${r || '/'}<span class="n">${n}</span></span>`,
                )}
              </div>
            </div>`
          : ''}
        <div class="results-meta">
          Showing ${filtered.length} of ${this.leaks.length}
        </div>
        ${filtered.length === 0
          ? html`<div class="none">No matches.</div>`
          : html`<lit-virtualizer
              class="scroller"
              .items=${filtered}
              .renderItem=${(l: LeakEntry) => html`<leak-row .leak=${l}></leak-row>`}
            ></lit-virtualizer>`}
      </div>
    `;
  }
}
