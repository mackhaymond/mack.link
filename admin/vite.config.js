import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    // M11: emit sourcemaps but don't reference them in the bundle, so prod
    // errors are debuggable while source isn't leaked to the public bundle.
    sourcemap: 'hidden',

    rollupOptions: {
      output: {
        // Ensure consistent asset naming for embedding
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Reduce chunk size for worker limits
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
          query: ['@tanstack/react-query'],
          router: ['react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
    // Optimize for size since workers have bundle limits
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
})
