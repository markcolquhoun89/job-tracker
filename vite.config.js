import { defineConfig } from 'vite';

export default defineConfig({
  // Keep compatibility with deployments that define SUPABASE_* instead of VITE_*
  envPrefix: ['VITE_', 'SUPABASE_'],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        uiLab: 'ui-lab.html'
      }
    }
  },
  server: {
    host: true,
    port: 3000
  }
});