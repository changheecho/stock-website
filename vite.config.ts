import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createAccountHandler, createStockSearchHandler } from './server/account.ts'

function accountApiPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const handler = createAccountHandler(env)
  const stockSearchHandler = createStockSearchHandler(env)

  return {
    name: 'account-api',
    configureServer(server) {
      server.middlewares.use('/api/account', handler)
      server.middlewares.use('/api/stocks/search', stockSearchHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/account', handler)
      server.middlewares.use('/api/stocks/search', stockSearchHandler)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), accountApiPlugin(mode)],
}))
