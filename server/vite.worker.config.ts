import { defineConfig } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const virtualAssetsId = 'virtual:site-assets'
const resolvedVirtualAssetsId = `\0${virtualAssetsId}`
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

const collectFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? collectFiles(path) : [path]
})

const bundledAssetsPlugin = () => ({
  name: 'bundled-site-assets',
  resolveId(id: string) {
    if (id === virtualAssetsId) return resolvedVirtualAssetsId
  },
  load(id: string) {
    if (id !== resolvedVirtualAssetsId) return
    const clientDirectory = resolve(process.cwd(), 'dist')
    const entries = collectFiles(clientDirectory)
      .filter((file) => !relative(clientDirectory, file).startsWith('server/'))
      .map((file) => {
        const pathname = `/${relative(clientDirectory, file).split('\\').join('/')}`
        return [pathname, {
          body: readFileSync(file).toString('base64'),
          contentType: contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
        }]
      })
    return `export const siteAssets = new Map(${JSON.stringify(entries)})`
  },
})

export default defineConfig({
  plugins: [bundledAssetsPlugin()],
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
