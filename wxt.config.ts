import { defineConfig } from 'wxt';

// For profiling (tools/profiling): a build without minification, so profiles show the real function
// names, in its own folder next to the normal build.
const profiling = process.env.PROFILE === '1';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Explicit imports instead of auto-imports, so every file shows where its symbols come from.
  imports: false,
  ...(profiling ? { outDir: '.output/profile', vite: () => ({ build: { minify: false } }) } : {}),
  manifest: {
    name: 'Web Tracking Detector',
    description: 'An extension to detect web tracking scripts on visited websites.',
    permissions: ['webRequest', 'webNavigation', 'storage', 'declarativeNetRequest', 'browsingData'],
    host_permissions: ['<all_urls>'],
  },
});
