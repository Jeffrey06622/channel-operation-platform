import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('lucide-react')) return 'icons-vendor';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
