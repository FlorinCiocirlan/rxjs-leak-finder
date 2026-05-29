import { describe, it, expect } from 'vitest';
import { isFrameworkUrl, topUserFrameUrl } from '../../src/shared/framework-filter.js';

describe('isFrameworkUrl', () => {
  it('flags vite deps and zone.js', () => {
    expect(isFrameworkUrl('http://localhost/node_modules/.vite/deps/rxjs.js')).toBe(false); // not matched by URL patterns
    expect(isFrameworkUrl('http://localhost/vite/deps/rxjs.js')).toBe(true);
    expect(isFrameworkUrl('http://localhost/zone.js')).toBe(true);
    expect(isFrameworkUrl('http://localhost/src/app.component.ts')).toBe(false);
  });
});

describe('topUserFrameUrl', () => {
  it('returns the first non-framework frame url', () => {
    const stack = [
      'Error',
      '    at patchedSubscribe (http://localhost/vite/deps/chunk.js:1:1)',
      '    at DashboardComponent.ngOnInit (http://localhost/src/dashboard.component.ts:48:10)',
    ].join('\n');
    expect(topUserFrameUrl(stack)).toBe('http://localhost/src/dashboard.component.ts');
  });

  it('returns null when every frame is framework', () => {
    const stack = 'Error\n    at x (http://localhost/zone.js:1:1)';
    expect(topUserFrameUrl(stack)).toBeNull();
  });
});
