import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Explicit imports instead of auto-imports, so every file shows where its symbols come from.
  imports: false,
  manifest: {
    name: 'Web Tracking Detector',
    description: 'An extension to detect web tracking scripts on visited websites.',
    permissions: ['webRequest', 'webNavigation'],
    host_permissions: ['<all_urls>'],
  },
});
