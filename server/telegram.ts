import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type TelegramEvent = 'login' | 'buyFill' | 'sellFill'
export type TelegramSettings = { chatId: string; login: boolean; buyFill: boolean; sellFill: boolean }
export type FillNotification = {
  environment: 'domestic-mock' | 'overseas-mock'
  code: string
  side: 'buy' | 'sell'
  orderNo: string
  quantity: number
  price: number
}

const dataDirectory = resolve(process.cwd(), '.data')
const settingsFile = resolve(dataDirectory, 'telegram-notifications.json')
const defaultSettings = (): TelegramSettings => ({
  chatId: process.env.TELEGRAM_CHAT_ID?.trim() || '7492040528',
  login: true,
  buyFill: true,
  sellFill: true,
})
const eventLabels: Record<TelegramEvent, string> = { login: '로그인', buyFill: '매수 체결', sellFill: '매도 체결' }
const notifiedFillQuantities = new Map<string, number>()
const pendingFills = new Set<string>()

const normalizedSettings = (value: unknown): TelegramSettings => {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const defaults = defaultSettings()
  return {
    chatId: typeof input.chatId === 'string' && /^-?\d{1,30}$/.test(input.chatId) ? input.chatId : defaults.chatId,
    login: typeof input.login === 'boolean' ? input.login : defaults.login,
    buyFill: typeof input.buyFill === 'boolean' ? input.buyFill : defaults.buyFill,
    sellFill: typeof input.sellFill === 'boolean' ? input.sellFill : defaults.sellFill,
  }
}

export const getTelegramSettings = async () => {
  try {
    return normalizedSettings(JSON.parse(await readFile(settingsFile, 'utf8')))
  } catch {
    return defaultSettings()
  }
}

const saveSettings = async (settings: TelegramSettings) => {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const temporaryFile = `${settingsFile}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryFile, settingsFile)
}

const sendTelegramMessage = async (env: NodeJS.ProcessEnv, chatId: string, text: string) => {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(5_000),
    })
    const result = await response.json() as { ok?: boolean }
    return response.ok && result.ok === true
  } catch {
    return false
  }
}

const formatTimestamp = () => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date())

export const notifyLogin = async (env: NodeJS.ProcessEnv) => {
  const settings = await getTelegramSettings()
  if (!settings.login) return
  await sendTelegramMessage(env, settings.chatId, `🔐 ${eventLabels.login}\nPortfolio Desk\n${formatTimestamp()}`)
}

export const notifyFill = async (env: NodeJS.ProcessEnv, fill: FillNotification) => {
  const event: TelegramEvent = fill.side === 'buy' ? 'buyFill' : 'sellFill'
  const settings = await getTelegramSettings()
  if (!settings[event]) return
  const dedupeKey = `${fill.environment}:${fill.side}:${fill.orderNo}`
  const previousQuantity = notifiedFillQuantities.get(dedupeKey) ?? 0
  const quantity = fill.quantity - previousQuantity
  if (quantity <= 0 || pendingFills.has(dedupeKey)) return
  pendingFills.add(dedupeKey)
  try {
    const environment = fill.environment === 'domestic-mock' ? '국내 모의투자' : '해외 모의투자'
    const currency = fill.environment === 'domestic-mock' ? '원' : '달러'
    const amount = fill.price * quantity
    const message = `✅ ${eventLabels[event]}\n${environment}\n${fill.code} · ${quantity.toLocaleString('ko-KR')}주\n체결가: ${fill.price.toLocaleString('ko-KR')} ${currency}\n체결 금액: ${amount.toLocaleString('ko-KR')} ${currency}\n${formatTimestamp()}`
    if (await sendTelegramMessage(env, settings.chatId, message)) notifiedFillQuantities.set(dedupeKey, fill.quantity)
  } finally {
    pendingFills.delete(dedupeKey)
  }
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

const readSettingsBody = async (request: IncomingMessage) => {
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString()
    if (Buffer.byteLength(body) > 4096) return null
  }
  try { return JSON.parse(body) as unknown } catch { return null }
}

export const createTelegramSettingsHandler = (env: NodeJS.ProcessEnv) => async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method === 'GET') {
    return sendJson(response, 200, { settings: await getTelegramSettings(), configured: Boolean(env.TELEGRAM_BOT_TOKEN) })
  }
  if (request.method !== 'PUT') {
    response.setHeader('allow', 'GET, PUT')
    return sendJson(response, 405, { message: '지원하지 않는 요청입니다.' })
  }
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    return sendJson(response, 415, { message: 'JSON 요청만 지원합니다.' })
  }
  const body = await readSettingsBody(request)
  if (!body || typeof body !== 'object') return sendJson(response, 400, { message: '알림 설정 형식을 확인해 주세요.' })
  const input = body as Record<string, unknown>
  if (typeof input.chatId !== 'string' || !/^-?\d{1,30}$/.test(input.chatId.trim())
    || typeof input.login !== 'boolean' || typeof input.buyFill !== 'boolean' || typeof input.sellFill !== 'boolean') {
    return sendJson(response, 400, { message: 'chat_id와 알림 설정 값을 확인해 주세요.' })
  }
  const settings: TelegramSettings = {
    chatId: input.chatId.trim(), login: input.login, buyFill: input.buyFill, sellFill: input.sellFill,
  }
  try {
    await saveSettings(settings)
    return sendJson(response, 200, { settings, configured: Boolean(env.TELEGRAM_BOT_TOKEN) })
  } catch {
    return sendJson(response, 500, { message: '알림 설정을 저장하지 못했습니다.' })
  }
}
