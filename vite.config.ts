import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (!res.headersSent) {
              res.writeHead(504, { 'Content-Type': 'application/json' });
            }
            res.end(
              JSON.stringify({
                error: err.code === 'ETIMEDOUT' ? 'Gateway timeout' : 'Proxy error',
              }),
            );
          });
        },
      },
    },
  },
});
