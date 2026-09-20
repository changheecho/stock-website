import type { IncomingMessage, ServerResponse } from 'node:http'
import { siteAssets } from 'virtual:site-assets'
import { createAccountHandler, createRankingHandler, createStockSearchHandler, createTradingHandler } from './account.ts'
export { setExternalApiLogSink } from './account.ts'

type WorkerEnvironment = NodeJS.ProcessEnv & {
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

const decodeAsset = (encoded: string) => Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))

const serveAsset = (pathname: string) => {
  const asset = siteAssets.get(pathname === '/' ? '/index.html' : pathname)
    ?? (!pathname.startsWith('/api/') ? siteAssets.get('/index.html') : undefined)
  if (!asset) return null
  return new Response(decodeAsset(asset.body), {
    headers: {
      'content-type': asset.contentType,
      'cache-control': pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    },
  })
}

const runHandler = async (
  request: Request,
  handler: ReturnType<typeof createAccountHandler>,
  relativePath: string,
) => {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? new Uint8Array()
    : new Uint8Array(await request.arrayBuffer())
  const nodeRequest = {
    method: request.method,
    url: relativePath,
    async *[Symbol.asyncIterator]() {
      if (body.byteLength) yield body
    },
  } as unknown as IncomingMessage

  let status = 200
  const headers = new Headers()
  let responseBody = ''
  const nodeResponse = {
    get statusCode() { return status },
    set statusCode(value: number) { status = value },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
      return this
    },
    end(chunk?: string | Uint8Array) {
      if (typeof chunk === 'string') responseBody = chunk
      else if (chunk) responseBody = new TextDecoder().decode(chunk)
      return this
    },
  } as unknown as ServerResponse

  await handler(nodeRequest, nodeResponse)
  return new Response(responseBody, { status, headers })
}

export default {
  async fetch(request: Request, env: WorkerEnvironment) {
    const url = new URL(request.url)
    const relativePath = `${url.pathname}${url.search}`

    if (url.pathname === '/api/account') {
      return runHandler(request, createAccountHandler(env), relativePath)
    }
    if (url.pathname === '/api/stocks/search') {
      return runHandler(request, createStockSearchHandler(env), relativePath)
    }
    if (url.pathname === '/api/rankings') {
      return runHandler(request, createRankingHandler(env), relativePath)
    }
    if (url.pathname.startsWith('/api/trade/')) {
      return runHandler(request, createTradingHandler(env), `${url.pathname.slice('/api/trade'.length)}${url.search}`)
    }

    const bundledAsset = serveAsset(url.pathname)
    if (bundledAsset) return bundledAsset
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not found', { status: 404 })
  },
}
