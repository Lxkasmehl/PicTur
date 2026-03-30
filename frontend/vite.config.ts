import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // Listen on all network interfaces
    port: 5173, // Must match playwright.config.ts webServer.url and baseURL
    strictPort: true, // Fail if 5173 is in use so Playwright’s readiness check doesn’t time out
    allowedHosts: [
      '.loca.lt', // Allow all localtunnel subdomains
    ],
  },
} as const);
