import { defineConfig } from 'vite';

import { getBasePath } from './src/shared/siteBase';

export default defineConfig(({ mode }) => ({
  base: getBasePath(mode),
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
}));
