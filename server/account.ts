import type { IncomingMessage, ServerResponse } from 'node:http'

type Environment = 'domestic-mock' | 'overseas-mock'
type SecretConfig = { appkey: string; secretkey: string }
type CachedToken = { value: string; expiresAt: number }

const MOCK_DOMAIN = 'https://mockapi.kiwoom.com'
const tokenCache = new Map<Environment, CachedToken>()

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
