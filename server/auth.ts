import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const SESSION_COOKIE = 'stock_session'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5
const MAX_LOGIN_BODY_BYTES = 4096

type Session = { expiresAt: number }
type AttemptWindow = { count: number; resetsAt: number; blockedUntil?: number }

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export class AuthManager {
  private readonly expectedPasswordHash: string | undefined
  private readonly sessions = new Map<string, Session>()
  private readonly attempts = new Map<string, AttemptWindow>()

  constructor(password: string | undefined) {
    this.expectedPasswordHash = password ? hash(password) : undefined
  }

  login(password: string, clientKey: string, now = Date.now()) {
    if (!this.expectedPasswordHash) return { status: 'unconfigured' as const }

    let window = this.attempts.get(clientKey)
    if (window?.blockedUntil && now < window.blockedUntil) {
      return { status: 'limited' as const, retryAfter: Math.ceil((window.blockedUntil - now) / 1000) }
    }
    if (!window || now >= window.resetsAt || (window.blockedUntil && now >= window.blockedUntil)) {
      window = { count: 0, resetsAt: now + LOGIN_WINDOW_MS }
      this.attempts.set(clientKey, window)
    }

    const suppliedHash = hash(password)
    if (timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(this.expectedPasswordHash, 'hex'))) {
      this.attempts.delete(clientKey)
      const sessionId = randomBytes(32).toString('base64url')
      this.sessions.set(hash(sessionId), { expiresAt: now + SESSION_TTL_MS })
      return { status: 'ok' as const, sessionId }
    }

    window.count += 1
    if (window.count >= LOGIN_MAX_ATTEMPTS) {
      window.blockedUntil = now + LOGIN_WINDOW_MS
      return { status: 'limited' as const, retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000) }
    }
    return { status: 'invalid' as const }
  }

  isAuthenticated(cookieHeader: string | undefined, now = Date.now()) {
    const sessionId = readCookie(cookieHeader, SESSION_COOKIE)
    if (!sessionId) return false
    const key = hash(sessionId)
    const session = this.sessions.get(key)
    if (!session) return false
    if (now >= session.expiresAt) {
      this.sessions.delete(key)
      return false
    }
    return true
  }

  logout(cookieHeader: string | undefined) {
    const sessionId = readCookie(cookieHeader, SESSION_COOKIE)
    if (sessionId) this.sessions.delete(hash(sessionId))
  }
}

const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('pragma', 'no-cache')
  response.end(JSON.stringify(body))
}

const sendLoginPage = (response: ServerResponse) => {
  response.statusCode = 200
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  response.end(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f7f6"><title>로그인 · Portfolio Desk</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7f6;color:#17251f;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(420px,calc(100% - 32px));padding:40px;background:white;border:1px solid #dce6e1;border-radius:20px;box-shadow:0 16px 50px #18382a0c}.mark{color:#26765a;font-size:14px;font-weight:700;letter-spacing:.06em}h1{margin:20px 0 8px;font-size:28px}p{margin:0 0 28px;color:#73847c}label{display:block;font-size:14px;font-weight:600}input{width:100%;margin-top:9px;padding:14px;border:1px solid #cbd9d2;border-radius:10px;font:inherit}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#17614a;color:white;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6}#message{min-height:22px;margin:12px 0 0;color:#bd4545;font-size:13px}
</style></head><body><main class="card"><div class="mark">PORTFOLIO DESK</div><h1>비밀번호 로그인</h1><p>계속하려면 접속 비밀번호를 입력하세요.</p><form id="login"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button id="submit" type="submit">로그인</button><div id="message" role="status" aria-live="polite"></div></form></main>
<script>const form=document.querySelector('#login'),input=document.querySelector('#password'),button=document.querySelector('#submit'),message=document.querySelector('#message');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;message.textContent='';try{const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({password:input.value})});const data=await response.json();if(response.ok){location.replace('/');return}message.textContent=data.message||'로그인할 수 없습니다.'}catch{message.textContent='서버에 연결하지 못했습니다.'}finally{button.disabled=false;input.value='';input.focus()}})</script></body></html>`)
}

const readLoginBody = async (request: IncomingMessage): Promise<string | null> => {
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString()
    if (Buffer.byteLength(body) > MAX_LOGIN_BODY_BYTES) return null
  }
  try {
    const parsed = JSON.parse(body) as { password?: unknown }
    return typeof parsed.password === 'string' ? parsed.password : ''
  } catch {
    return ''
  }
}

const getClientKey = (request: IncomingMessage) => {
  const forwarded = request.headers['x-forwarded-for']
  const chain = Array.isArray(forwarded)
    ? forwarded[forwarded.length - 1]
    : typeof forwarded === 'string' ? forwarded.split(',').slice(-1)[0] : undefined
  return chain?.trim() || request.socket.remoteAddress || 'unknown'
}

const isSecureRequest = (request: IncomingMessage) => {
  const forwarded = request.headers['x-forwarded-proto']
  const protocol = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded
  return (protocol ?? '').split(',').slice(-1)[0]?.trim() === 'https'
    || Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted)
}

const sessionCookie = (sessionId: string, secure: boolean) =>
  `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`

export const createAuthMiddleware = (password: string | undefined, manager = new AuthManager(password)) => async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (url.pathname === '/login' && (request.method === 'GET' || request.method === 'HEAD')) {
    sendLoginPage(response)
    return true
  }
  if (url.pathname === '/auth/login') {
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })
      return true
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { message: 'JSON 요청만 지원합니다.' })
      return true
    }
    const passwordInput = await readLoginBody(request)
    if (passwordInput === null) {
      sendJson(response, 413, { message: '요청 크기가 너무 큽니다.' })
      return true
    }
    const result = manager.login(passwordInput, getClientKey(request))
    if (result.status === 'unconfigured') {
      sendJson(response, 503, { message: '서버 비밀번호가 설정되지 않았습니다.' })
      return true
    }
    if (result.status === 'limited') {
      response.setHeader('retry-after', String(result.retryAfter))
      sendJson(response, 429, { message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' })
      return true
    }
    if (result.status === 'invalid') {
      sendJson(response, 401, { message: '비밀번호가 올바르지 않습니다.' })
      return true
    }
    response.setHeader('set-cookie', sessionCookie(result.sessionId, isSecureRequest(request)))
    sendJson(response, 200, { ok: true })
    return true
  }
  if (url.pathname === '/auth/logout') {
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })
      return true
    }
    manager.logout(request.headers.cookie)
    response.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${isSecureRequest(request) ? '; Secure' : ''}`)
    sendJson(response, 200, { ok: true })
    return true
  }

  if (manager.isAuthenticated(request.headers.cookie)) return false
  response.setHeader('cache-control', 'no-store')
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
    sendJson(response, 401, { message: '로그인이 필요합니다.' })
  } else {
    response.statusCode = 302
    response.setHeader('location', '/login')
    response.end()
  }
  return true
}
