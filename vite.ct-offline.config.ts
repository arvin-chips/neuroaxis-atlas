import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

// Single self-contained HTML for the CT Anatomy module (for iPad / phone / any
// device without a server): JS and CSS are inlined by vite-plugin-singlefile,
// then scripts/ct-anatomy/embed-offline.mjs inlines the case data.
// Build: npm run build:ct-offline  ->  dist-offline/ct-anatomy-offline.html
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: {
    target: 'esnext',
    minify: 'terser',
    outDir: 'dist-offline',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./ct-anatomy.html', import.meta.url)) },
  },
})
