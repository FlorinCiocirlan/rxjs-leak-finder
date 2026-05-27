import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('analyzer-core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
