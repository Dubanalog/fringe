import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Content Security Policy for the renderer. Production is strict: no inline
 * scripts, no remote code, no network. Dev additionally allows the inline
 * React Refresh preamble and the Vite HMR websocket.
 */
function contentSecurityPolicy(): Plugin {
  let isDev = false;
  return {
    name: 'fringe-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'none'",
        isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        isDev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        // Add-ons, each from its own fringe-addon:// page (see src/main/addons.ts).
        'frame-src fringe-addon:',
      ].join('; ');
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  main: {
    // Workspace packages are TypeScript source, so bundle them instead of externalizing.
    plugins: [externalizeDepsPlugin({ exclude: ['@fringe/budget-engine'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [react(), contentSecurityPolicy()],
  },
});
