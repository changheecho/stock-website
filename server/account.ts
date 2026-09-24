import type { IncomingMessage, ServerResponse } from 'node:http'

type Environment = 'domestic-live' | 'overseas-live' | 'domestic-mock' | 'overseas-mock'
type MockEnvironment = Extract<Environment, `${string}-mock`>
type SecretConfig = { appkey: string; secretkey: string }
type CachedToken = { value: string; expiresAt: number }
type StockItem = { code: string; name: string; englishName?: string; market: string; sector?: string; status?: string; isEtf?: boolean }
type CachedStocks = { value: StockItem[]; expiresAt: number }
type OrderRequest = { environment?: string; code?: string; exchange?: string; quantity?: number; price?: number; requestId?: string; side?: 'buy' | 'sell' }
type ExternalApiLogEntry = Record<string, unknown>
type ExternalApiLogSink = (entry: ExternalApiLogEntry) => void | Promise<void>

const LIVE_DOMAIN = 'https://api.kiwoom.com'
const MOCK_DOMAIN = 'https://mockapi.kiwoom.com'
const tokenCache = new Map<Environment, CachedToken>()
const stockCache = new Map<Environment, CachedStocks>()
const orderRequests = new Map<string, { expiresAt: number; result?: unknown }>()
let externalApiLogSink: ExternalApiLogSink = (entry) => console.log(JSON.stringify(entry))

export const setExternalApiLogSink = (sink: ExternalApiLogSink) => {
  externalApiLogSink = sink
}

const sensitiveField = /(?:authorization|token|secret|password|passwd|pwd|cookie|credential|session|app[_-]?key|secret[_-]?key|access[_-]?key|account[_-]?(?:number|no)|acnt[_-]?no)/i

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sensitiveField.test(key) ? '[REDACTED]' : redactSensitive(item),
  ]))
}

const parseLogBody = (body: BodyInit | null | undefined) => {
  if (typeof body !== 'string') return body ? '[NON_TEXT_BODY]' : undefined
  try {
    return redactSensitive(JSON.parse(body))
  } catch {
    return '[NON_JSON_BODY]'
  }
}

const writeExternalApiLog = (entry: ExternalApiLogEntry) => {
  try {
    void Promise.resolve(externalApiLogSink(entry)).catch(() => undefined)
  } catch {
    // Logging must never affect the API request.
  }
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

const environments: Environment[] = ['domestic-live', 'overseas-live', 'domestic-mock', 'overseas-mock']
const isEnvironment = (value: string | null): value is Environment => environments.includes(value as Environment)
const isMockEnvironment = (environment: Environment): environment is MockEnvironment => environment.endsWith('-mock')
const isOverseasEnvironment = (environment: Environment) => environment.startsWith('overseas-')
const apiDomain = (environment: Environment) => isMockEnvironment(environment) ? MOCK_DOMAIN : LIVE_DOMAIN

const getConfig = (env: NodeJS.ProcessEnv, environment: Environment): SecretConfig => {
  const prefix = `${isMockEnvironment(environment) ? 'MOCK' : 'LIVE'}_${isOverseasEnvironment(environment) ? 'OVERSEAS' : 'DOMESTIC'}`
  const appkey = env[`${prefix}_APP_KEY`]
  const secretkey = env[`${prefix}_APP_SECRET`]
  if (!appkey || !secretkey) throw new Error('선택한 환경의 서버 인증정보가 설정되지 않았습니다.')
  return { appkey, secretkey }
}

const requestKiwoom = async <T>(url: string, init: RequestInit): Promise<T> => {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  let responseLogged = false
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => { headers[key] = value })
  writeExternalApiLog({
    timestamp: new Date(startedAt).toISOString(),
    level: 'info',
    event: 'external_api_request',
    requestId,
    service: 'kiwoom',
    method: init.method ?? 'GET',
    url,
    headers: redactSensitive(headers),
    body: parseLogBody(init.body),
  })

  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    const data = (await response.json()) as T & { return_code?: number; return_msg?: string }
    const succeeded = response.ok && !(typeof data.return_code === 'number' && data.return_code !== 0)
    writeExternalApiLog({
      timestamp: new Date().toISOString(),
      level: succeeded ? 'info' : 'error',
      event: succeeded ? 'external_api_response_success' : 'external_api_response_failure',
      requestId,
      service: 'kiwoom',
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: redactSensitive(data),
    })
    responseLogged = true
    if (!succeeded) throw new Error(data.return_msg || `키움 API 요청에 실패했습니다. (${response.status})`)
    return data
  } catch (error) {
    if (!responseLogged) {
      writeExternalApiLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'external_api_response_failure',
        requestId,
        service: 'kiwoom',
        durationMs: Date.now() - startedAt,
        error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : '외부 API 요청 실패' },
      })
    }
    throw error
  }
}

const getToken = async (env: NodeJS.ProcessEnv, environment: Environment) => {
  const cached = tokenCache.get(environment)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value

  const config = getConfig(env, environment)
  const data = await requestKiwoom<{ token: string; expires_dt: string }>(`${apiDomain(environment)}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', ...config }),
  })

  const expiresAt = /^\d{14}$/.test(data.expires_dt)
    ? new Date(`${data.expires_dt.slice(0, 4)}-${data.expires_dt.slice(4, 6)}-${data.expires_dt.slice(6, 8)}T${data.expires_dt.slice(8, 10)}:${data.expires_dt.slice(10, 12)}:${data.expires_dt.slice(12, 14)}+09:00`).getTime()
    : Date.now() + 23 * 60 * 60 * 1000
  tokenCache.set(environment, { value: data.token, expiresAt })
  return data.token
}

const queryAccount = async (env: NodeJS.ProcessEnv, environment: Environment) => {
  const token = await getToken(env, environment)
  const overseas = isOverseasEnvironment(environment)
  const domain = apiDomain(environment)
  const request = (apiId: string, body: Record<string, string>) =>
    requestKiwoom<Record<string, unknown>>(`${domain}${overseas ? '/api/us/acnt' : '/api/dostk/acnt'}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        authorization: `Bearer ${token}`,
        'api-id': apiId,
      },
      body: JSON.stringify(body),
    })

  const [portfolio, cashBalance] = await Promise.all(
    overseas
      ? [request('ust21070', { stex_tp: '', stk_cd: '' }), request('ust21160', {})]
      : [request('kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' }), request('kt00001', { qry_tp: '3' })],
  )

  return { portfolio, cashBalance }
}

export const createAccountHandler = (env: NodeJS.ProcessEnv) => async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.method !== 'GET') return sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })

  const url = new URL(request.url || '/', 'http://localhost')
  const environment = url.searchParams.get('environment')
  if (!isEnvironment(environment)) {
    return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
  }

  try {
    sendJson(response, 200, await queryAccount(env, environment))
  } catch (error) {
    const message = error instanceof Error ? error.message : '계좌 정보를 불러오지 못했습니다.'
    sendJson(response, 502, { message })
  }
}

const queryStocks = async (env: NodeJS.ProcessEnv, environment: Environment) => {
  const cached = stockCache.get(environment)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const token = await getToken(env, environment)
  const headers = {
    'content-type': 'application/json;charset=UTF-8',
    authorization: `Bearer ${token}`,
  }
  let stocks: StockItem[]

  const domain = apiDomain(environment)
  if (!isOverseasEnvironment(environment)) {
    const requestMarket = (mrkt_tp: '0' | '10') => requestKiwoom<{ list?: Record<string, unknown>[] }>(
      `${domain}/api/dostk/stkinfo`,
      { method: 'POST', headers: { ...headers, 'api-id': 'ka10099' }, body: JSON.stringify({ mrkt_tp }) },
    )
    const markets = await Promise.all([requestMarket('0'), requestMarket('10')])
    stocks = markets.flatMap(({ list = [] }) => list.map((item) => ({
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      market: String(item.marketName ?? ''),
      sector: String(item.upName ?? ''),
      status: String(item.auditInfo ?? ''),
    })))
  } else {
    const data = await requestKiwoom<{ list?: Record<string, unknown>[] }>(`${domain}/api/us/stkinfo`, {
      method: 'POST',
      headers: { ...headers, 'api-id': 'usa10099' },
      body: JSON.stringify({ stex_tp: '%' }),
    })
    stocks = (data.list ?? []).map((item) => ({
      code: String(item.stk_cd ?? ''),
      name: String(item.stk_nm ?? ''),
      englishName: String(item.stk_enm ?? ''),
      market: String(item.mkgb ?? item.stex_tp ?? ''),
      sector: String(item.upgb ?? ''),
      isEtf: item.isEtf === 'Y',
    }))
  }

  stockCache.set(environment, { value: stocks, expiresAt: Date.now() + 10 * 60 * 1000 })
  return stocks
}

export const createStockSearchHandler = (env: NodeJS.ProcessEnv) => async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.method !== 'GET') return sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })

  const url = new URL(request.url || '/', 'http://localhost')
  const environment = url.searchParams.get('environment')
  const query = (url.searchParams.get('q') ?? '').trim()
  if (!isEnvironment(environment)) {
    return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
  }
  if (!query) return sendJson(response, 200, { items: [] })

  try {
    const normalizedQuery = query.toLocaleLowerCase('ko-KR')
    const items = (await queryStocks(env, environment))
      .filter((item) => [item.code, item.name, item.englishName ?? ''].some((value) => value.toLocaleLowerCase('ko-KR').includes(normalizedQuery)))
      .sort((a, b) => {
        const values = (item: StockItem) => [item.code, item.name, item.englishName ?? ''].map((value) => value.toLocaleLowerCase('ko-KR'))
        const rank = (item: StockItem) => values(item).some((value) => value === normalizedQuery) ? 0 : values(item).some((value) => value.startsWith(normalizedQuery)) ? 1 : 2
        return rank(a) - rank(b) || a.code.localeCompare(b.code)
      })
      .slice(0, 50)
    sendJson(response, 200, { items })
  } catch (error) {
    const message = error instanceof Error ? error.message : '종목을 검색하지 못했습니다.'
    sendJson(response, 502, { message })
  }
}

const readJsonBody = async (request: IncomingMessage): Promise<OrderRequest> => {
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
    size += bytes.byteLength
    if (size > 16_384) throw new Error('요청 데이터가 너무 큽니다.')
    text += decoder.decode(bytes, { stream: true })
  }
  text += decoder.decode()
  return JSON.parse(text) as OrderRequest
}

const exchangeCode = (market: string) => {
  const normalized = market.toUpperCase()
  if (normalized.includes('NASDAQ') || normalized === 'ND') return 'ND'
  if (normalized.includes('NYSE') || normalized === 'NY') return 'NY'
  if (normalized.includes('AMEX') || normalized === 'NA') return 'NA'
  return null
}

const resolveExchangeCode = async (env: NodeJS.ProcessEnv, environment: Environment, code: string, market: string) => {
  const direct = exchangeCode(market)
  if (direct || !isOverseasEnvironment(environment)) return direct
  const stock = (await queryStocks(env, environment)).find((item) => item.code === code)
  return stock ? exchangeCode(stock.market) : null
}

const normalizeNumber = (value: unknown) => Number(String(value ?? '0').split(',').join('').replace(/^\+/, '')) || 0

const getQuote = async (env: NodeJS.ProcessEnv, environment: Environment, code: string, exchange: string) => {
  const token = await getToken(env, environment)
  const headers = { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}` }
  const domain = apiDomain(environment)
  if (!isOverseasEnvironment(environment)) {
    const data = await requestKiwoom<Record<string, unknown>>(`${domain}/api/dostk/stkinfo`, {
      method: 'POST', headers: { ...headers, 'api-id': 'ka10001' }, body: JSON.stringify({ stk_cd: code }),
    })
    return {
      code: String(data.stk_cd ?? code), name: String(data.stk_nm ?? ''), currency: 'KRW',
      currentPrice: Math.abs(normalizeNumber(data.cur_prc)), change: normalizeNumber(data.pred_pre), changeRate: normalizeNumber(data.flu_rt),
      volume: normalizeNumber(data.trde_qty), high: Math.abs(normalizeNumber(data.high_pric)), low: Math.abs(normalizeNumber(data.low_pric)),
      canBuy: /^\d{6}$/.test(code), unavailableReason: /^\d{6}$/.test(code) ? undefined : '국내 주문은 6자리 종목코드만 지원합니다.',
    }
  }

  const stex_tp = await resolveExchangeCode(env, environment, code, exchange)
  if (!stex_tp) return { code, name: '', currency: 'USD', currentPrice: 0, change: 0, changeRate: 0, volume: 0, high: 0, low: 0, canBuy: false, unavailableReason: 'NASDAQ, NYSE, AMEX 종목만 모의 매수를 지원합니다.' }
  const data = await requestKiwoom<Record<string, unknown>>(`${domain}/api/us/mrkcond`, {
    method: 'POST', headers: { ...headers, 'api-id': 'usa20100' }, body: JSON.stringify({ stex_tp, stk_cd: code }),
  })
  const suspended = String(data.trd_susp_tp ?? '')
  return {
    code: String(data.stk_cd ?? code), name: String(data.stk_nm ?? ''), englishName: String(data.stk_enm ?? ''), currency: 'USD',
    currentPrice: Math.abs(normalizeNumber(data.cur_prc)), change: normalizeNumber(data.pred_pre), changeRate: normalizeNumber(data.flu_rt),
    volume: normalizeNumber(data.acc_trde_qty), high: Math.abs(normalizeNumber(data.high_pric)), low: Math.abs(normalizeNumber(data.low_pric)),
    canBuy: suspended !== '1', unavailableReason: suspended === '1' ? '현재 거래정지 종목으로 매수할 수 없습니다.' : undefined,
  }
}

const placeOrder = async (env: NodeJS.ProcessEnv, body: OrderRequest) => {
  const environment = body.environment
  if (environment !== 'domestic-mock' && environment !== 'overseas-mock') throw new Error('모의투자 환경에서만 주문할 수 있습니다.')
  const code = String(body.code ?? '').trim().toUpperCase()
  const requestId = String(body.requestId ?? '')
  const quantity = Number(body.quantity)
  const price = Number(body.price)
  const side = body.side === 'sell' ? 'sell' : 'buy'
  if (!requestId || !code || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price <= 0) throw new Error('주문 수량과 가격을 확인해 주세요.')

  const previous = orderRequests.get(requestId)
  if (previous && previous.expiresAt > Date.now()) {
    if (previous.result) return previous.result
    throw new Error('동일한 주문을 처리 중입니다.')
  }
  orderRequests.set(requestId, { expiresAt: Date.now() + 10 * 60 * 1000 })

  try {
    const token = await getToken(env, environment)
    const headers = { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}` }
    const overseas = environment === 'overseas-mock'
    const stex_tp = overseas ? await resolveExchangeCode(env, environment, code, String(body.exchange ?? '')) : null
    if (overseas && !stex_tp) throw new Error('이 거래소는 해외 모의투자 주문을 지원하지 않습니다.')
    if (!overseas && !/^\d{6}$/.test(code)) throw new Error('국내 주문은 6자리 종목코드만 지원합니다.')

    if (side === 'sell') {
      const balance = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}${overseas ? '/api/us/acnt' : '/api/dostk/acnt'}`, {
        method: 'POST',
        headers: { ...headers, 'api-id': overseas ? 'ust21070' : 'kt00018' },
        body: JSON.stringify(overseas ? { stex_tp: stex_tp ?? '', stk_cd: code } : { qry_tp: '1', dmst_stex_tp: 'KRX' }),
      })
      const holdings = (overseas ? balance.result_list : balance.acnt_evlt_remn_indv_tot) as Record<string, unknown>[] | undefined
      const holding = (holdings ?? []).find((item) => String(overseas ? item.stk_cd : item.stk_cd).replace(/^[AJQ]/, '') === code)
      const availableQuantity = normalizeNumber(overseas ? holding?.sell_alowq : holding?.trde_able_qty)
      if (availableQuantity < quantity) throw new Error(`최신 매도 가능 수량(${availableQuantity}주)을 초과했습니다.`)
    }

    const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}${overseas ? '/api/us/ordr' : '/api/dostk/ordr'}`, {
      method: 'POST',
      headers: { ...headers, 'api-id': overseas ? (side === 'sell' ? 'ust20001' : 'ust20000') : (side === 'sell' ? 'kt10001' : 'kt10000') },
      body: JSON.stringify(overseas
        ? { stex_tp, stk_cd: code, ord_qty: String(quantity), ord_uv: price.toFixed(4), ...(side === 'sell' ? { stop_pric: '' } : {}), trde_tp: '00' }
        : { dmst_stex_tp: 'KRX', stk_cd: code, ord_qty: String(quantity), ord_uv: String(Math.trunc(price)), trde_tp: '0', cond_uv: '' }),
    })
    const result = { orderNo: String(data.ord_no ?? ''), name: String(data.stk_nm ?? ''), status: 'accepted', message: `모의 ${side === 'sell' ? '매도' : '매수'} 주문이 접수되었습니다.` }
    orderRequests.set(requestId, { expiresAt: Date.now() + 10 * 60 * 1000, result })
    return result
  } catch (error) {
    orderRequests.delete(requestId)
    throw error
  }
}

const getOrderStatus = async (env: NodeJS.ProcessEnv, environment: MockEnvironment, code: string, exchange: string, orderNo: string, side: 'buy' | 'sell') => {
  const token = await getToken(env, environment)
  const headers = { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}` }
  if (environment === 'domestic-mock') {
    const data = await requestKiwoom<{ acnt_ord_cntr_prps_dtl?: Record<string, unknown>[] }>(`${MOCK_DOMAIN}/api/dostk/acnt`, {
      method: 'POST', headers: { ...headers, 'api-id': 'kt00007' },
      body: JSON.stringify({ ord_dt: '', qry_tp: '1', stk_bond_tp: '1', sell_tp: side === 'sell' ? '1' : '2', stk_cd: code, fr_ord_no: '', dmst_stex_tp: 'KRX' }),
    })
    const item = (data.acnt_ord_cntr_prps_dtl ?? []).find((row) => String(row.ord_no ?? '').replace(/^0+/, '') === orderNo.replace(/^0+/, ''))
    if (!item) return { state: 'checking', label: '주문 내역 확인 중', filledQuantity: 0, remainingQuantity: 0 }
    const filledQuantity = normalizeNumber(item.cntr_qty)
    const remainingQuantity = normalizeNumber(item.ord_remnq)
    return { state: remainingQuantity === 0 && filledQuantity > 0 ? 'filled' : 'pending', label: remainingQuantity === 0 && filledQuantity > 0 ? '체결 완료' : String(item.acpt_tp ?? '접수'), filledQuantity, remainingQuantity, filledPrice: normalizeNumber(item.cntr_uv) }
  }

  const stex_tp = await resolveExchangeCode(env, environment, code, exchange)
  if (!stex_tp) throw new Error('지원하지 않는 해외 거래소입니다.')
  const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}/api/us/acnt`, {
    method: 'POST', headers: { ...headers, 'api-id': 'ust21510' }, body: JSON.stringify({ slby_tp: side === 'sell' ? '1' : '2', stex_tp, stk_cd: code }),
  })
  const list = ((data.result_list ?? data.result_lsit) as Record<string, unknown>[] | undefined) ?? []
  const item = list.find((row) => String(row.ord_no ?? '').replace(/^0+/, '') === orderNo.replace(/^0+/, ''))
  if (!item) return { state: 'checking', label: '주문 내역 확인 중', filledQuantity: 0, remainingQuantity: 0 }
  const filledQuantity = normalizeNumber(item.cntr_qty)
  const remainingQuantity = normalizeNumber(item.ord_remnq)
  const label = String(item.ord_stat ?? '접수')
  return { state: label === '체결완료' || (remainingQuantity === 0 && filledQuantity > 0) ? 'filled' : 'pending', label, filledQuantity, remainingQuantity, filledPrice: normalizeNumber(item.cntr_uv) }
}

export const createTradingHandler = (env: NodeJS.ProcessEnv) => async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url || '/', 'http://localhost')
  try {
    if (request.method === 'GET' && url.pathname === '/quote') {
      const environment = url.searchParams.get('environment')
      if (!isEnvironment(environment)) return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
      return sendJson(response, 200, await getQuote(env, environment, url.searchParams.get('code') ?? '', url.searchParams.get('exchange') ?? ''))
    }
    if (request.method === 'POST' && url.pathname === '/orders') {
      const body = await readJsonBody(request)
      if (body.environment !== 'domestic-mock' && body.environment !== 'overseas-mock') {
        return sendJson(response, 403, { message: '실투자 환경에서는 매수·매도 주문을 실행할 수 없습니다.' })
      }
      return sendJson(response, 200, await placeOrder(env, body))
    }
    if (request.method === 'GET' && url.pathname === '/order-status') {
      const environment = url.searchParams.get('environment')
      if (environment !== 'domestic-mock' && environment !== 'overseas-mock') return sendJson(response, 403, { message: '실투자 환경에서는 주문 상태를 조회하지 않습니다.' })
      return sendJson(response, 200, await getOrderStatus(env, environment, url.searchParams.get('code') ?? '', url.searchParams.get('exchange') ?? '', url.searchParams.get('orderNo') ?? '', url.searchParams.get('side') === 'sell' ? 'sell' : 'buy'))
    }
    return sendJson(response, 404, { message: '요청한 거래 경로를 찾을 수 없습니다.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '거래 요청을 처리하지 못했습니다.'
    sendJson(response, 502, { message })
  }
}

type RankingKind = 'value' | 'gainers' | 'volume' | 'popular'
type RankingItem = { rank: number; code: string; name: string; englishName?: string; market: string; price: number; changeRate: number; metric: number; metricLabel: string }

const rankingList = (data: Record<string, unknown>, key: string) => ((data[key] as Record<string, unknown>[] | undefined) ?? [])

const queryRankings = async (env: NodeJS.ProcessEnv, environment: Environment) => {
  const token = await getToken(env, environment)
  const overseas = isOverseasEnvironment(environment)
  const domain = apiDomain(environment)
  const rankingUrl = `${domain}${overseas ? '/api/us/rkinfo' : '/api/dostk/rkinfo'}`
  const request = (apiId: string, body: Record<string, string>, url = rankingUrl) => requestKiwoom<Record<string, unknown>>(url, {
    method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}`, 'api-id': apiId }, body: JSON.stringify(body),
  })

  const responses = await Promise.all(overseas ? [
    request('usa20540', { stex_tp: '0', inds_cd: '', stk_tp: '0', trde_qty_tp: '0', stk_cnd: '0', pric_cnd: '0', trde_prica_cnd: '0' }),
    request('usa20510', { stex_tp: '0', inds_cd: '', stk_tp: '0', stk_cnd: '0', tm: '1', trde_qty_tp: '0', pric_cnd: '0', trde_prica_cnd: '0' }),
    request('usa20530', { stex_tp: '0', inds_cd: '', stk_tp: '0', trde_qty_tp: '0', qry_tp: '0', stk_cnd: '0', pric_cnd: '0', trde_prica_cnd: '0' }),
    request('usa01980', { svc_type: 'B281' }),
  ] : [
    request('ka10032', { mrkt_tp: '000', mang_stk_incls: '0', stex_tp: '1' }),
    request('ka10027', { mrkt_tp: '000', sort_tp: '1', trde_qty_cnd: '0000', stk_cnd: '0', crd_cnd: '0', updown_incls: '1', pric_cnd: '0', trde_prica_cnd: '0', stex_tp: '1' }),
    request('ka10030', { mrkt_tp: '000', sort_tp: '1', mang_stk_incls: '0', crd_tp: '0', trde_qty_tp: '0', pric_tp: '0', trde_prica_tp: '0', mrkt_open_tp: '0', stex_tp: '1' }),
    request('ka00198', { qry_tp: '1' }, `${domain}/api/dostk/stkinfo`),
  ])

  const kinds: RankingKind[] = ['value', 'gainers', 'volume', 'popular']
  const keys = overseas ? ['result_list', 'result_list', 'result_list', 'result_list'] : ['trde_prica_upper', 'pred_pre_flu_rt_upper', 'tdy_trde_qty_upper', 'item_inq_rank']
  return Object.fromEntries(kinds.map((kind, index) => {
    const rows = rankingList(responses[index], keys[index]).slice(0, 10)
    const items: RankingItem[] = rows.map((item, rowIndex) => ({
      rank: normalizeNumber(item.rank ?? item.now_rank ?? item.bigd_rank) || rowIndex + 1,
      code: String(item.stk_cd ?? '').replace(/^[AJQ]/, ''),
      name: String(item.stk_nm ?? ''),
      englishName: overseas ? String(item.stk_enm ?? '') : undefined,
      market: overseas ? String(item.stex_tp ?? '') : 'KRX',
      price: Math.abs(normalizeNumber(item.cur_prc ?? item.curr_pric ?? item.past_curr_prc)),
      changeRate: normalizeNumber(item.flu_rt ?? item.diff_rate_for_gjga ?? item.base_comp_chgr),
      metric: kind === 'value' ? normalizeNumber(item.trde_prica) : kind === 'volume' ? normalizeNumber(item.acc_trde_qty ?? item.trde_qty) : kind === 'popular' ? normalizeNumber(item.rank_chg ?? item.chg_val) : normalizeNumber(item.flu_rt),
      metricLabel: kind === 'value' ? '거래대금' : kind === 'volume' ? '거래량' : kind === 'popular' ? '순위 변화' : '등락률',
    }))
    return [kind, items]
  }))
}

export const createRankingHandler = (env: NodeJS.ProcessEnv) => async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== 'GET') return sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })
  const url = new URL(request.url || '/', 'http://localhost')
  const environment = url.searchParams.get('environment')
  if (!isEnvironment(environment)) return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
  try {
    sendJson(response, 200, await queryRankings(env, environment))
  } catch (error) {
    sendJson(response, 502, { message: error instanceof Error ? error.message : '순위 정보를 불러오지 못했습니다.' })
  }
}
