import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'server/node.ts',
    outDir: 'dist/server',
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    target: 'node',
    noExternal: true,
  },
})
