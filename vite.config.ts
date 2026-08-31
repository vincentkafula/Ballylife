import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    assetsInclude: ['**/*.svg'],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      assetsInlineLimit: 4096,
      minify: 'esbuild',
      sourcemap: false,
      cssCodeSplit: true,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_URL ?? 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'lucide-react', 'recharts', 'sonner'],
    },
  }
})
