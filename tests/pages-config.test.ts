import { describe, expect, it } from 'vitest';

import { getBasePath, githubPagesBase } from '../src/shared/siteBase';

describe('GitHub Pages base path', () => {
  it('uses the repository path for production builds', () => {
    expect(githubPagesBase).toBe('/hexagon-universalis/');
    expect(getBasePath('production')).toBe('/hexagon-universalis/');
  });

  it('keeps local development at the root path', () => {
    expect(getBasePath('development')).toBe('/');
  });
});
