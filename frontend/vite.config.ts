import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // Listen on all network interfaces
    port: 5173, // Explicitly set port for consistency
    strictPort: true,
    allowedHosts: [
      '.loca.lt', // Allow all localtunnel subdomains
    ],
  },
} as const);
