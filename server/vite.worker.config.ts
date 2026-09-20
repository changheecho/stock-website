import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'server/worker.ts',
    outDir: 'dist/server',
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    target: 'webworker',
    noExternal: true,
  },
})
