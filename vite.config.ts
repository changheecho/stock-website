import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createAccountHandler } from './server/account.ts'

function accountApiPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const handler = createAccountHandler(env)

  return {
    name: 'account-api',
    configureServer(server) {
      server.middlewares.use('/api/account', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/account', handler)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), accountApiPlugin(mode)],
}))
