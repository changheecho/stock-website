import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthMiddleware } from './auth.ts'
import {
  createAccountHandler,
  createRankingHandler,
  createStockSearchHandler,
  createTradingHandler,
  setExternalApiLogSink,
} from './account.ts'

try {
  process.loadEnvFile()
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3000)
const clientDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const indexFile = resolve(clientDirectory, 'index.html')
const logDirectory = resolve(process.cwd(), '.logs')
const logFile = resolve(logDirectory, 'external-api.jsonl')
const logDirectoryReady = mkdir(logDirectory, { recursive: true })

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

setExternalApiLogSink(async (entry) => {
  try {
    await logDirectoryReady
    await appendFile(logFile, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Logging is best-effort and must not fail application requests.
  }
})

const handlers = {
  account: createAccountHandler(process.env),
  rankings: createRankingHandler(process.env),
  search: createStockSearchHandler(process.env),
  trading: createTradingHandler(process.env),
}
const authenticate = createAuthMiddleware(process.env.PASSWORD)

const sendText = (response: ServerResponse, status: number, text: string) => {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(text)
}

const serveFile = async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return sendText(response, 400, 'Bad request')
  }

  const requestedFile = resolve(clientDirectory, `.${decodedPath}`)
  const withinClientDirectory = requestedFile === clientDirectory || requestedFile.startsWith(`${clientDirectory}${sep}`)
  if (!withinClientDirectory) return sendText(response, 403, 'Forbidden')

  let file = requestedFile
  try {
    if (decodedPath === '/' || !(await stat(file)).isFile()) file = indexFile
  } catch {
    file = indexFile
  }

  try {
    const body = await readFile(file)
    const extension = extname(file).toLowerCase()
    response.statusCode = 200
    response.setHeader('content-type', contentTypes[extension] ?? 'application/octet-stream')
    response.setHeader('cache-control', extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    sendText(response, 404, 'Not found')
  }
}

const server = createServer(async (request, response) => {
  try {
    if (await authenticate(request, response)) return
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (url.pathname === '/healthz') return sendText(response, 200, 'ok')
    if (url.pathname === '/api/account') return handlers.account(request, response)
    if (url.pathname === '/api/stocks/search') return handlers.search(request, response)
    if (url.pathname === '/api/rankings') return handlers.rankings(request, response)
    if (url.pathname.startsWith('/api/trade/')) {
      request.url = `${url.pathname.slice('/api/trade'.length)}${url.search}`
      return handlers.trading(request, response)
    }
    if (url.pathname.startsWith('/api/')) return sendText(response, 404, 'Not found')
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendText(response, 405, 'Method not allowed')

    await serveFile(request, response, url.pathname)
  } catch (error) {
    console.error(error)
    if (!response.headersSent) sendText(response, 500, 'Internal server error')
    else response.end()
  }
})

server.requestTimeout = 30_000
server.headersTimeout = 30_000
server.keepAliveTimeout = 5_000

server.listen(port, host, () => {
  console.log(`Stock website listening on http://${host}:${port}`)
})

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}; shutting down`)
  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
