import { defineConfig, loadEnv, type Plugin } from 'vite'
import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createAccountHandler, createRankingHandler, createStockSearchHandler, createTradingHandler, setExternalApiLogSink } from './server/account.ts'

const logDirectory = resolve(process.cwd(), '.logs')
const logFile = resolve(logDirectory, 'external-api.jsonl')
const logDirectoryReady = mkdir(logDirectory, { recursive: true })

setExternalApiLogSink(async (entry) => {
  try {
    await logDirectoryReady
    await appendFile(logFile, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Log persistence is best-effort and must not fail application requests.
  }
})

function accountApiPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const handler = createAccountHandler(env)
  const stockSearchHandler = createStockSearchHandler(env)
  const tradingHandler = createTradingHandler(env)
  const rankingHandler = createRankingHandler(env)

  return {
    name: 'account-api',
    configureServer(server) {
      server.middlewares.use('/api/account', handler)
      server.middlewares.use('/api/stocks/search', stockSearchHandler)
      server.middlewares.use('/api/trade', tradingHandler)
      server.middlewares.use('/api/rankings', rankingHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/account', handler)
      server.middlewares.use('/api/stocks/search', stockSearchHandler)
      server.middlewares.use('/api/trade', tradingHandler)
      server.middlewares.use('/api/rankings', rankingHandler)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), accountApiPlugin(mode)],
}))
