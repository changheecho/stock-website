import { getStrategyToken, invalidateStrategyToken, type MockEnvironment } from './account.ts'

export type FeedQuote = { environment: MockEnvironment; code: string; exchange: string; price: number; time: string }
export type FeedOrder = { environment: MockEnvironment; code: string; exchange: string; orderNo: string; side: 'buy' | 'sell'; status: string; fillId: string; filledQuantity: number }
export type FeedPosition = { environment: MockEnvironment; code: string; exchange: string; quantity: number; averagePrice: number }
type FeedCallbacks = { onQuote: (item: FeedQuote) => void; onOrder: (item: FeedOrder) => void; onPosition: (item: FeedPosition) => void; onHealth: (environment: MockEnvironment, healthy: boolean, message?: string) => void }
type FeedState = { socket?: WebSocket; timer?: ReturnType<typeof setTimeout>; stopped: boolean; loggedIn: boolean; healthy: boolean; reconnects: number; subscriptions: string; seen: Set<string> }

const number = (value: unknown) => Number(String(value ?? '0').replaceAll(',', '').replace(/^\+/, '')) || 0
const codeOf = (item: unknown) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).jmcode ?? '') : ''

export class StrategyFeed {
  private readonly env: NodeJS.ProcessEnv
  private readonly callbacks: FeedCallbacks
  private readonly states = new Map<MockEnvironment, FeedState>()
  private readonly positions = new Map<MockEnvironment, Array<{ code: string; exchange: string }>>()

  constructor(env: NodeJS.ProcessEnv, callbacks: FeedCallbacks) {
    this.env = env
    this.callbacks = callbacks
    for (const environment of ['domestic-mock', 'overseas-mock'] as const) {
      const state: FeedState = { stopped: false, loggedIn: false, healthy: false, reconnects: 0, subscriptions: '', seen: new Set() }
      this.states.set(environment, state)
      void this.connect(environment)
    }
  }

  updatePositions(environment: MockEnvironment, positions: Array<{ code: string; exchange: string }>) {
    this.positions.set(environment, positions)
    const state = this.states.get(environment)
    if (state?.loggedIn) this.register(environment, state)
  }

  stop() {
    for (const state of this.states.values()) {
      state.stopped = true
      if (state.timer) clearTimeout(state.timer)
      state.socket?.close()
    }
  }

  private async connect(environment: MockEnvironment) {
    const state = this.states.get(environment)!
    if (state.stopped) return
    try {
      const token = await getStrategyToken(this.env, environment)
      const path = environment === 'domestic-mock' ? '/api/dostk/websocket' : '/api/us/websocket'
      const socket = new WebSocket(`wss://mockapi.kiwoom.com:10000${path}`)
      state.socket = socket
      const loginTimeout = setTimeout(() => socket.close(), 15_000)
      let registered = false
      socket.addEventListener('open', () => socket.send(JSON.stringify({ trnm: 'LOGIN', token })))
      socket.addEventListener('message', (event) => {
        const raw = typeof event.data === 'string' ? event.data : ''
        let message: Record<string, unknown>
        try { message = JSON.parse(raw) as Record<string, unknown> } catch { return }
        const trnm = String(message.trnm ?? '').toUpperCase()
        if (trnm === 'PING' || raw.trim().toUpperCase() === 'PING') { socket.send(raw.trim().toUpperCase() === 'PING' ? 'PING' : JSON.stringify(message)); return }
        if (trnm === 'LOGIN') {
          clearTimeout(loginTimeout)
          if (number(message.return_code) !== 0) { invalidateStrategyToken(environment); socket.close(); return }
          state.loggedIn = true
          this.register(environment, state)
          if (environment === 'overseas-mock' && !(this.positions.get(environment)?.length)) this.health(environment, true)
          return
        }
        if (trnm === 'REG') {
          if (number(message.return_code) !== 0) { this.health(environment, false, String(message.return_msg ?? '실시간 종목 등록에 실패했습니다.')); return }
          registered = true
          state.reconnects = 0
          this.health(environment, true)
          return
        }
        if (trnm !== 'REAL' || !Array.isArray(message.data)) return
        for (const row of message.data as Record<string, unknown>[]) this.consume(environment, state, row)
      })
      socket.addEventListener('close', () => {
        clearTimeout(loginTimeout)
        if (state.socket === socket) state.socket = undefined
        state.loggedIn = false
        if (!state.stopped) {
          this.health(environment, false, registered ? '실시간 연결이 끊겼습니다.' : '웹소켓 로그인이 끊겼습니다.')
          state.reconnects += 1
          state.timer = setTimeout(() => void this.connect(environment), Math.min(60_000, 1_000 * 2 ** Math.min(state.reconnects, 6)))
          state.timer.unref()
        }
      })
      socket.addEventListener('error', () => { this.health(environment, false, '실시간 연결에 오류가 발생했습니다.'); socket.close() })
      const registrationTimeout = setTimeout(() => {
        if (state.loggedIn && !registered && environment === 'domestic-mock') { this.health(environment, false, '실시간 등록 응답이 없어 자동 감시를 멈췄습니다.'); socket.close() }
      }, 15_000)
      socket.addEventListener('close', () => clearTimeout(registrationTimeout), { once: true })
    } catch (error) {
      this.health(environment, false, error instanceof Error ? error.message : '실시간 연결 오류')
      state.reconnects += 1
      state.timer = setTimeout(() => void this.connect(environment), Math.min(60_000, 1_000 * 2 ** Math.min(state.reconnects, 6)))
      state.timer.unref()
    }
  }

  private register(environment: MockEnvironment, state: FeedState) {
    if (!state.loggedIn || state.socket?.readyState !== WebSocket.OPEN) return
    const positions = this.positions.get(environment) ?? []
    const signature = JSON.stringify(positions.map(({ code, exchange }) => [code, exchange]).sort())
    if (state.subscriptions === signature && state.healthy) return
    state.subscriptions = signature
    const data = environment === 'domestic-mock'
      ? [{ item: [''], type: ['00', '04'] }, ...(positions.length ? [{ item: positions.map((item) => item.code), type: ['0B'] }] : [])]
      : positions.length ? [{ item: positions.map((item) => ({ jmcode: item.code, stex_tp: item.exchange })), type: ['F4', 'F5', 'FE'] }] : []
    if (data.length) state.socket.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '0', data }))
    else if (environment === 'overseas-mock') this.health(environment, true)
  }

  private consume(environment: MockEnvironment, state: FeedState, row: Record<string, unknown>) {
    const type = String(row.type ?? '')
    const code = codeOf(row.item)
    const values = row.values && typeof row.values === 'object' ? row.values as Record<string, unknown> : {}
    const exchange = environment === 'overseas-mock'
      ? String(row.stexTp ?? this.positions.get(environment)?.find((item) => item.code === code)?.exchange ?? '')
      : String(values['9081'] ?? 'KRX')
    const orderNo = String(values['9203'] ?? '')
    const fillId = String(values['909'] ?? '')
    const stamp = String(values['908'] ?? values['20'] ?? values['51020'] ?? '')
    const dedupe = `${type}:${code}:${orderNo}:${fillId}:${stamp}:${String(values['10'] ?? '')}:${String(values['913'] ?? '')}`
    if (state.seen.has(dedupe)) return
    state.seen.add(dedupe)
    if (state.seen.size > 20_000) state.seen.clear()
    if ((type === '0B' || type === 'FE') && code) {
      const price = Math.abs(number(values['10']))
      if (price > 0) this.callbacks.onQuote({ environment, code, exchange, price, time: stamp })
    }
    if ((type === '04' || type === 'F5') && code) this.callbacks.onPosition({ environment, code, exchange, quantity: number(values['930']), averagePrice: number(values['931']) })
    if ((type === '00' || type === 'F4' || type === 'F5') && code) {
      const sell = environment === 'overseas-mock' ? String(values['907']) === '01' : String(values['907']) === '1'
      this.callbacks.onOrder({ environment, code, exchange, orderNo, side: sell ? 'sell' : 'buy', status: String(values['913'] ?? ''), fillId, filledQuantity: number(values['911']) })
    }
  }

  private health(environment: MockEnvironment, healthy: boolean, message?: string) {
    const state = this.states.get(environment)!
    state.healthy = healthy
    this.callbacks.onHealth(environment, healthy, message)
  }
}
