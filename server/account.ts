import type { IncomingMessage, ServerResponse } from 'node:http'

type Environment = 'domestic-mock' | 'overseas-mock'
type SecretConfig = { appkey: string; secretkey: string }
type CachedToken = { value: string; expiresAt: number }
type StockItem = { code: string; name: string; englishName?: string; market: string; sector?: string; status?: string; isEtf?: boolean }
type CachedStocks = { value: StockItem[]; expiresAt: number }
type OrderRequest = { environment?: string; code?: string; exchange?: string; quantity?: number; price?: number; requestId?: string }

const MOCK_DOMAIN = 'https://mockapi.kiwoom.com'
const tokenCache = new Map<Environment, CachedToken>()
const stockCache = new Map<Environment, CachedStocks>()
const orderRequests = new Map<string, { expiresAt: number; result?: unknown }>()

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

const getConfig = (env: NodeJS.ProcessEnv, environment: Environment): SecretConfig => {
  const prefix = environment === 'domestic-mock' ? 'MOCK_DOMESTIC' : 'MOCK_OVERSEAS'
  const appkey = env[`${prefix}_APP_KEY`]
  const secretkey = env[`${prefix}_APP_SECRET`]
  if (!appkey || !secretkey) throw new Error('선택한 환경의 서버 인증정보가 설정되지 않았습니다.')
  return { appkey, secretkey }
}

const requestKiwoom = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  const data = (await response.json()) as T & { return_code?: number; return_msg?: string }
  if (!response.ok || (typeof data.return_code === 'number' && data.return_code !== 0)) {
    throw new Error(data.return_msg || `키움 API 요청에 실패했습니다. (${response.status})`)
  }
  return data
}

const getToken = async (env: NodeJS.ProcessEnv, environment: Environment) => {
  const cached = tokenCache.get(environment)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value

  const config = getConfig(env, environment)
  const data = await requestKiwoom<{ token: string; expires_dt: string }>(`${MOCK_DOMAIN}/oauth2/token`, {
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
  const overseas = environment === 'overseas-mock'
  const request = (apiId: string, body: Record<string, string>) =>
    requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}${overseas ? '/api/us/acnt' : '/api/dostk/acnt'}`, {
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
  if (environment !== 'domestic-mock' && environment !== 'overseas-mock') {
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

  if (environment === 'domestic-mock') {
    const requestMarket = (mrkt_tp: '0' | '10') => requestKiwoom<{ list?: Record<string, unknown>[] }>(
      `${MOCK_DOMAIN}/api/dostk/stkinfo`,
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
    const data = await requestKiwoom<{ list?: Record<string, unknown>[] }>(`${MOCK_DOMAIN}/api/us/stkinfo`, {
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
  if (environment !== 'domestic-mock' && environment !== 'overseas-mock') {
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
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw new Error('요청 데이터가 너무 큽니다.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as OrderRequest
}

const exchangeCode = (market: string) => {
  const normalized = market.toUpperCase()
  if (normalized.includes('NASDAQ') || normalized === 'ND') return 'ND'
  if (normalized.includes('NYSE') || normalized === 'NY') return 'NY'
  if (normalized.includes('AMEX') || normalized === 'NA') return 'NA'
  return null
}

const normalizeNumber = (value: unknown) => Number(String(value ?? '0').split(',').join('').replace(/^\+/, '')) || 0

const getQuote = async (env: NodeJS.ProcessEnv, environment: Environment, code: string, exchange: string) => {
  const token = await getToken(env, environment)
  const headers = { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}` }
  if (environment === 'domestic-mock') {
    const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}/api/dostk/stkinfo`, {
      method: 'POST', headers: { ...headers, 'api-id': 'ka10001' }, body: JSON.stringify({ stk_cd: code }),
    })
    return {
      code: String(data.stk_cd ?? code), name: String(data.stk_nm ?? ''), currency: 'KRW',
      currentPrice: Math.abs(normalizeNumber(data.cur_prc)), change: normalizeNumber(data.pred_pre), changeRate: normalizeNumber(data.flu_rt),
      volume: normalizeNumber(data.trde_qty), high: Math.abs(normalizeNumber(data.high_pric)), low: Math.abs(normalizeNumber(data.low_pric)),
      canBuy: /^\d{6}$/.test(code), unavailableReason: /^\d{6}$/.test(code) ? undefined : '국내 주문은 6자리 종목코드만 지원합니다.',
    }
  }

  const stex_tp = exchangeCode(exchange)
  if (!stex_tp) return { code, name: '', currency: 'USD', currentPrice: 0, change: 0, changeRate: 0, volume: 0, high: 0, low: 0, canBuy: false, unavailableReason: 'NASDAQ, NYSE, AMEX 종목만 모의 매수를 지원합니다.' }
  const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}/api/us/mrkcond`, {
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
    const stex_tp = overseas ? exchangeCode(String(body.exchange ?? '')) : null
    if (overseas && !stex_tp) throw new Error('이 거래소는 해외 모의투자 주문을 지원하지 않습니다.')
    if (!overseas && !/^\d{6}$/.test(code)) throw new Error('국내 주문은 6자리 종목코드만 지원합니다.')

    const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}${overseas ? '/api/us/ordr' : '/api/dostk/ordr'}`, {
      method: 'POST',
      headers: { ...headers, 'api-id': overseas ? 'ust20000' : 'kt10000' },
      body: JSON.stringify(overseas
        ? { stex_tp, stk_cd: code, ord_qty: String(quantity), ord_uv: price.toFixed(4), trde_tp: '00' }
        : { dmst_stex_tp: 'KRX', stk_cd: code, ord_qty: String(quantity), ord_uv: String(Math.trunc(price)), trde_tp: '0', cond_uv: '' }),
    })
    const result = { orderNo: String(data.ord_no ?? ''), name: String(data.stk_nm ?? ''), status: 'accepted', message: '모의 매수 주문이 접수되었습니다.' }
    orderRequests.set(requestId, { expiresAt: Date.now() + 10 * 60 * 1000, result })
    return result
  } catch (error) {
    orderRequests.delete(requestId)
    throw error
  }
}

const getOrderStatus = async (env: NodeJS.ProcessEnv, environment: Environment, code: string, exchange: string, orderNo: string) => {
  const token = await getToken(env, environment)
  const headers = { 'content-type': 'application/json;charset=UTF-8', authorization: `Bearer ${token}` }
  if (environment === 'domestic-mock') {
    const data = await requestKiwoom<{ acnt_ord_cntr_prps_dtl?: Record<string, unknown>[] }>(`${MOCK_DOMAIN}/api/dostk/acnt`, {
      method: 'POST', headers: { ...headers, 'api-id': 'kt00007' },
      body: JSON.stringify({ ord_dt: '', qry_tp: '1', stk_bond_tp: '1', sell_tp: '2', stk_cd: code, fr_ord_no: '', dmst_stex_tp: 'KRX' }),
    })
    const item = (data.acnt_ord_cntr_prps_dtl ?? []).find((row) => String(row.ord_no ?? '').replace(/^0+/, '') === orderNo.replace(/^0+/, ''))
    if (!item) return { state: 'checking', label: '주문 내역 확인 중', filledQuantity: 0, remainingQuantity: 0 }
    const filledQuantity = normalizeNumber(item.cntr_qty)
    const remainingQuantity = normalizeNumber(item.ord_remnq)
    return { state: remainingQuantity === 0 && filledQuantity > 0 ? 'filled' : 'pending', label: remainingQuantity === 0 && filledQuantity > 0 ? '체결 완료' : String(item.acpt_tp ?? '접수'), filledQuantity, remainingQuantity, filledPrice: normalizeNumber(item.cntr_uv) }
  }

  const stex_tp = exchangeCode(exchange)
  if (!stex_tp) throw new Error('지원하지 않는 해외 거래소입니다.')
  const data = await requestKiwoom<Record<string, unknown>>(`${MOCK_DOMAIN}/api/us/acnt`, {
    method: 'POST', headers: { ...headers, 'api-id': 'ust21510' }, body: JSON.stringify({ slby_tp: '2', stex_tp, stk_cd: code }),
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
      if (environment !== 'domestic-mock' && environment !== 'overseas-mock') return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
      return sendJson(response, 200, await getQuote(env, environment, url.searchParams.get('code') ?? '', url.searchParams.get('exchange') ?? ''))
    }
    if (request.method === 'POST' && url.pathname === '/orders') return sendJson(response, 200, await placeOrder(env, await readJsonBody(request)))
    if (request.method === 'GET' && url.pathname === '/order-status') {
      const environment = url.searchParams.get('environment')
      if (environment !== 'domestic-mock' && environment !== 'overseas-mock') return sendJson(response, 400, { message: '지원하지 않는 투자 환경입니다.' })
      return sendJson(response, 200, await getOrderStatus(env, environment, url.searchParams.get('code') ?? '', url.searchParams.get('exchange') ?? '', url.searchParams.get('orderNo') ?? ''))
    }
    return sendJson(response, 404, { message: '요청한 거래 경로를 찾을 수 없습니다.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '거래 요청을 처리하지 못했습니다.'
    sendJson(response, 502, { message })
  }
}
