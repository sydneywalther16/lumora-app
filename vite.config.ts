import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE_URL || env.VITE_API_URL || 'http://localhost:8787';

  return {
    plugins: [react()],
    server: {
      port: 4173,
      // Run npm run dev:api in a second terminal for local video/API routes.
      proxy: mode === 'development' ? {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/health': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      } : undefined,
    },
  };
});
