export const githubPagesBase = '/hexagon-universalis/';

export const getBasePath = (mode: string): string =>
  mode === 'production' ? githubPagesBase : '/';
