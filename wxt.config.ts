import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// Files of the repository that go with every build, so a copy passed on (a release's zip) has its
// license and the notices of the code it includes, as the GPL asks.
const SHIPPED_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];

// For profiling (tools/profiling): a build without minification, so profiles show the real function
// names, in its own folder next to the normal build.
const profiling = process.env.PROFILE === '1';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Explicit imports instead of auto-imports, so every file shows where its symbols come from.
  imports: false,
  hooks: {
    'build:publicAssets': (wxt, files) => {
      for (const file of SHIPPED_FILES) files.push({ absoluteSrc: resolve(wxt.config.root, file), relativeDest: file });
    },
  },
  ...(profiling ? { outDir: '.output/profile', vite: () => ({ build: { minify: false } }) } : {}),
  manifest: {
    name: 'Glove',
    description: 'See which scripts on a page fingerprint your browser and how, so you can avoid them or block them.',
    permissions: ['webRequest', 'webNavigation', 'storage', 'declarativeNetRequest', 'browsingData', 'scripting'],
    host_permissions: ['<all_urls>'],
  },
});
