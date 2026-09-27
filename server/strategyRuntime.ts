import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createDefaultStrategySettings, parseStrategySettings, type StrategyMarketSettings, type StrategySettingsDocument, type TrailingStopMarketSettings, type DeadCrossMarketSettings } from '../src/strategySettings.ts'
import type { MockEnvironment } from './account.ts'
import { fetchStrategyBars, fetchStrategyOpenSells, fetchStrategyOrders, fetchStrategyPositions, KiwoomRejectedError, submitStrategyMarketSell } from './account.ts'
import { detectDeadCross, detectThreshold, eligibleSettings, hasEnabledStrategy, positionChanged, positionKey, updateTrailingPeak, type PositionState, type StrategyEnvironment, type StrategyId, type StrategyPosition } from './strategyCore.ts'
import { StrategyFeed } from './strategyFeed.ts'
import { withSellLock } from './orderCoordinator.ts'

type RuntimeFile = { settings: StrategySettingsDocument; configured: boolean; positions: PositionState[]; inventory?: Partial<Record<StrategyEnvironment, string[]>>; lastError?: string; faulted?: boolean }
const environments: StrategyEnvironment[] = ['domestic-mock', 'overseas-mock']
const positive = (value: unknown) => Number(String(value ?? '0').replaceAll(',', '').replace(/^\+/, '')) || 0

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

class StrategyStore {
  readonly path: string
  private value: RuntimeFile = { settings: createDefaultStrategySettings(), configured: false, positions: [] }
  private ready: Promise<void>
  private writes: Promise<void> = Promise.resolve()

  constructor(path: string) {
    this.path = path
    this.ready = this.load()
  }

  private async load() {
    try {
      const loaded = JSON.parse(await readFile(this.path, 'utf8')) as Partial<RuntimeFile>
      const settings = loaded.settings ? parseStrategySettings(JSON.stringify(loaded.settings)) : createDefaultStrategySettings()
      const positions = Array.isArray(loaded.positions) ? loaded.positions : []
      this.value = { settings, configured: loaded.configured === true, positions, lastError: typeof loaded.lastError === 'string' ? loaded.lastError : undefined }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.value.faulted = true
        this.value.lastError = '저장된 전략 상태가 손상되었습니다. 중복 주문 방지를 위해 자동 감시를 중지했습니다.'
      }
    }
  }

  async get() { await this.ready; return structuredClone(this.value) }
  async update(change: (current: RuntimeFile) => RuntimeFile) {
    await this.ready
    this.value = change(structuredClone(this.value))
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(this.value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.path)
    })
    await this.writes
    return structuredClone(this.value)
  }
}

export type StrategyRuntimeOptions = {
  env: NodeJS.ProcessEnv
  dataDirectory?: string
  intervalMs?: number
  tradingEnabled?: boolean
}

export class StrategyRuntime {
  private readonly env: NodeJS.ProcessEnv
  private readonly store: StrategyStore
  private readonly intervalMs: number
  private readonly tradingEnabled: boolean
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  private readonly busy = new Set<string>()
  private readonly signalsBusy = new Set<string>()
  private readonly feed: StrategyFeed
  private readonly feedHealth = new Map<StrategyEnvironment, boolean>()
  private readonly latestQuotes = new Map<string, { price: number; receivedAt: number }>()

  constructor(options: StrategyRuntimeOptions) {
    this.env = options.env
    this.store = new StrategyStore(resolve(options.dataDirectory ?? process.env.STRATEGY_DATA_DIR ?? resolve(process.cwd(), '.data'), 'strategies.json'))
    this.intervalMs = options.intervalMs ?? 30_000
    this.tradingEnabled = options.tradingEnabled ?? false
    this.feed = new StrategyFeed(this.env, {
      onQuote: (quote) => { void this.onQuote(quote) },
      onOrder: (order) => { void this.onRealtimeOrder(order) },
      onPosition: (position) => { void this.onRealtimePosition(position) },
      onHealth: (environment, healthy, message) => {
        this.feedHealth.set(environment, healthy)
        if (!healthy && message) void this.store.update((value) => ({ ...value, lastError: message }))
      },
    })
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref()
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.feed.stop()
  }

  async settings() { return this.store.get() }
  async saveSettings(text: string) {
    const settings = parseStrategySettings(text)
    const current = await this.store.get()
    if (current.faulted) throw new Error('저장된 실행 상태를 복구하기 전에는 전략을 수정하거나 켤 수 없습니다.')
    if (current.positions.some((position) => ['pending', 'unknown'].includes(position.status))) {
      throw new Error('매도 주문이 진행 중인 동안에는 전략 설정을 바꿀 수 없습니다. 주문 상태 확인 후 다시 시도해 주세요.')
    }
    await this.store.update((value) => ({ ...value, settings, configured: true, lastError: undefined }))
  }

  async status() {
    const state = await this.store.get()
    return { tradingEnabled: this.tradingEnabled && !state.faulted, feed: Object.fromEntries(this.feedHealth), lastError: state.lastError ?? null, positions: state.positions }
  }

  async resume(environment: StrategyEnvironment, code: string, exchange: string) {
    const previous = await this.store.get()
    if (previous.faulted) throw new Error('저장된 실행 상태를 복구하기 전에는 감시를 재개할 수 없습니다.')
    const existingState = previous.positions.find((item) => positionKey(item) === positionKey({ environment, code, exchange }))
    if (existingState && (existingState.status === 'pending' || existingState.status === 'unknown')) throw new Error('진행 중이거나 결과가 불분명한 주문은 자동 재개할 수 없습니다. 키움 주문 내역을 확인해 주세요.')
    const positions = await fetchStrategyPositions(this.env, environment as MockEnvironment)
    const position = positions.find((item) => item.code === code && item.exchange === exchange)
    if (!position) throw new Error('현재 계좌에서 해당 종목을 찾을 수 없습니다.')
    await this.store.update((current) => {
      const key = positionKey({ environment, code, exchange })
      const existing = current.positions.filter((item) => positionKey(item) !== key)
      return { ...current, positions: [...existing, { ...position, environment, status: 'monitoring', peakPrice: position.currentPrice, updatedAt: new Date().toISOString() }] }
    })
  }

  async beforeManualSell(environment: MockEnvironment, code: string, exchange: string) {
    const current = await this.store.get()
    const key = positionKey({ environment, code, exchange })
    const state = current.positions.find((item) => positionKey(item) === key)
    if (state && (state.status === 'pending' || state.status === 'unknown')) throw new Error('자동 매도 주문의 결과를 먼저 확인해야 수동 매도할 수 있습니다.')
    if (state?.status === 'monitoring') await this.patchPosition(state, { status: 'paused-external-change', reason: '앱에서 수동 매도 요청을 시작했습니다. 계좌 확인 후 전략을 다시 켜 주세요.' })
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      const stateAtStart = await this.store.get()
      if (stateAtStart.faulted) return
      for (const environment of environments) await this.scanEnvironment(environment)
      await this.store.update((state) => state.faulted ? state : ({ ...state, lastError: undefined }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '전략 계좌를 조회하지 못했습니다.'
      await this.store.update((state) => ({ ...state, lastError: message }))
    } finally {
      this.running = false
    }
  }

  private async scanEnvironment(environment: StrategyEnvironment) {
    const keyName = `account:${environment}`
    if (this.busy.has(keyName)) return
    this.busy.add(keyName)
    try {
      const snapshot = await fetchStrategyPositions(this.env, environment as MockEnvironment)
      this.feed.updatePositions(environment as MockEnvironment, snapshot.map((item) => ({ code: item.code, exchange: item.exchange })))
      const current = await this.store.get()
      const states = new Map(current.positions.map((state) => [positionKey(state), state]))
      const firstInventory = current.inventory?.[environment] === undefined
      const knownInventory = new Set(current.inventory?.[environment] ?? [])
      const seen = new Set<string>()

      for (const position of snapshot) {
        const key = positionKey({ environment, code: position.code, exchange: position.exchange })
        seen.add(key)
        let state = states.get(key)
        if (!state) {
          state = {
            ...position, environment,
            status: (firstInventory || knownInventory.has(key)) && hasEnabledStrategy(current.settings, environment, position) ? 'monitoring' : 'paused-external-change',
            peakPrice: position.currentPrice,
            reason: !(firstInventory || knownInventory.has(key))
              ? '이전 잔고 확인 이후 새 보유 종목이 생겼습니다. 확인 후 감시를 재개해 주세요.'
              : hasEnabledStrategy(current.settings, environment, position) ? undefined : '해당 시장에서 켜진 자동매도 전략이 없습니다.',
            updatedAt: new Date().toISOString(),
          }
          states.set(key, state)
          continue
        }
        if (state.status === 'pending' || state.status === 'unknown') {
          await this.reconcile(environment, position, state)
          continue
        }
        if (state.status === 'completed') {
          states.set(key, { ...state, ...position, status: 'paused-external-change', reason: '매도 완료 뒤 새 보유 수량을 확인했습니다. 외부 매수를 검토해 주세요.', updatedAt: new Date().toISOString() })
          continue
        }
        if (state.status !== 'monitoring') continue
        if (positionChanged(state, position)) {
          states.set(key, { ...state, ...position, status: 'paused-external-change', reason: '계좌 보유 수량 또는 평균 매입가 변경을 확인했습니다.', updatedAt: new Date().toISOString() })
          continue
        }
        const liveQuote = this.latestQuotes.get(key)
        if (this.feedHealth.get(environment) && liveQuote && Date.now() - liveQuote.receivedAt <= 60_000) await this.evaluate(environment, { ...position, currentPrice: liveQuote.price }, state, current.settings, true)
      }

      // A previously held position disappearing without an acknowledged strategy fill is an external change.
      for (const [key, state] of states) {
        if (state.environment !== environment || seen.has(key) || ['completed', 'paused-failure', 'paused-external-change'].includes(state.status)) continue
        if (state.status === 'pending' || state.status === 'unknown') {
          await this.reconcile(environment, null, state)
        } else if (state.status === 'monitoring') {
          states.set(key, { ...state, status: 'paused-external-change', reason: '계좌에서 보유 종목이 사라졌습니다. 외부 거래 여부를 확인해 주세요.', updatedAt: new Date().toISOString() })
        }
      }
      await this.store.update((value) => ({ ...value, positions: [...states.values()], inventory: { ...value.inventory, [environment]: [...seen] } }))
    } finally {
      this.busy.delete(keyName)
    }
  }

  private async evaluate(environment: StrategyEnvironment, position: StrategyPosition, state: PositionState, document: StrategySettingsDocument, quoteOnly = false) {
    const lockKey = positionKey({ environment, code: position.code, exchange: position.exchange })
    if (this.signalsBusy.has(lockKey)) return
    this.signalsBusy.add(lockKey)
    try {
    const settings = eligibleSettings(document, environment, position)
    if (!settings.length || position.currentPrice <= 0 || position.availableQuantity <= 0) return
    const market = environment.startsWith('overseas-') ? 'overseas' : 'domestic'
    const currentMarketTime = new Intl.DateTimeFormat('en-GB', { timeZone: market === 'domestic' ? 'Asia/Seoul' : 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
    const inWindow = settings.filter(({ settings }) => currentMarketTime >= settings.startTime && currentMarketTime < settings.endTime)
    if (!inWindow.length) return
    let peakPrice = state.peakPrice || position.currentPrice
    const triggers: StrategyId[] = []

    for (const item of inWindow) {
      if (item.id === 'stopLossTakeProfit') {
        if (detectThreshold(item.settings as StrategyMarketSettings, position.averagePrice, position.currentPrice)) triggers.push(item.id)
      } else if (item.id === 'trailingStop') {
        const trailing = updateTrailingPeak(item.settings as TrailingStopMarketSettings, position.averagePrice, position.currentPrice, peakPrice)
        peakPrice = trailing.peakPrice
        if (trailing.triggered) triggers.push(item.id)
      } else if (!quoteOnly) {
        const deadCross = item.settings as DeadCrossMarketSettings
        const requiredBars = deadCross.longMAPeriod * 2
        const bars = await fetchStrategyBars(this.env, environment as MockEnvironment, position.code, position.exchange, deadCross.barType, deadCross.barInterval, requiredBars)
        const result = detectDeadCross(deadCross, bars, state.lastBarKey)
        state = { ...state, lastBarKey: result.barKey ?? state.lastBarKey }
        if (result.triggered) triggers.push(item.id)
      }
    }

    state = { ...state, peakPrice, updatedAt: new Date().toISOString() }
    if (!triggers.length) {
      const key = positionKey(state)
      await this.store.update((value) => ({ ...value, positions: value.positions.map((item) => positionKey(item) === key ? state : item) }))
      return
    }

    const key = positionKey(state)
    const freshSnapshot = await fetchStrategyPositions(this.env, environment as MockEnvironment)
    const fresh = freshSnapshot.find((item) => item.code === position.code && item.exchange === position.exchange)
    if (!fresh || fresh.quantity !== position.quantity || fresh.averagePrice !== position.averagePrice) {
      await this.patchPosition(state, { status: 'paused-external-change', reason: '주문 직전 계좌 수량이 변경되어 자동 매도를 중지했습니다.' })
      return
    }
    const openSells = await fetchStrategyOpenSells(this.env, environment as MockEnvironment, position.code)
    if (openSells.length > 0) {
      await this.patchPosition(state, { status: 'paused-external-change', reason: '미체결 매도 주문이 있어 자동 주문을 막았습니다.' })
      return
    }
    const intentId = crypto.randomUUID()
    if (!this.tradingEnabled) {
      await this.patchPosition(state, { status: 'monitoring', triggeredBy: triggers, reason: `관찰 모드 신호: ${triggers.join(', ')} · 주문은 전송하지 않았습니다.` })
      return
    }
    const pending: PositionState = { ...state, status: 'unknown', intentId, orderQuantity: fresh.availableQuantity, filledQuantity: 0, triggeredBy: triggers, reason: '주문 접수 여부를 확인 중입니다.', updatedAt: new Date().toISOString() }
    await this.store.update((value) => ({ ...value, positions: value.positions.map((item) => positionKey(item) === key ? pending : item) }))
    try {
      await withSellLock(key, async () => {
        const currentState = await this.store.get()
        const stillCurrent = currentState.positions.find((item) => positionKey(item) === key)
        if (!stillCurrent || stillCurrent.intentId !== pending.intentId || stillCurrent.status !== 'unknown') return
        const lockedSnapshot = await fetchStrategyPositions(this.env, environment as MockEnvironment)
        const locked = lockedSnapshot.find((item) => item.code === position.code && item.exchange === position.exchange)
        if (!locked || locked.quantity !== position.quantity || locked.averagePrice !== position.averagePrice || locked.availableQuantity <= 0) {
          await this.patchPosition(pending, { status: 'paused-external-change', reason: '주문 직전 계좌 상태가 바뀌어 자동 매도를 중지했습니다.' })
          return
        }
        const lockedOpenSells = await fetchStrategyOpenSells(this.env, environment as MockEnvironment, position.code)
        if (lockedOpenSells.length) {
          await this.patchPosition(pending, { status: 'paused-external-change', reason: '주문 직전 기존 미체결 매도 주문을 발견했습니다.' })
          return
        }
        const orderNo = await submitStrategyMarketSell(this.env, environment as MockEnvironment, position.code, position.exchange, locked.availableQuantity)
        await this.patchPosition(pending, { status: 'pending', orderNo, orderQuantity: locked.availableQuantity, reason: `시장가 매도 주문 접수 (${orderNo})` })
      })
    } catch (error) {
      // Even a rejection is paused; transport errors may mean the broker accepted the order without a response.
      const status = error instanceof KiwoomRejectedError ? 'paused-failure' : 'unknown'
      await this.patchPosition(pending, { status, reason: error instanceof Error ? error.message : '주문 결과를 확인하지 못했습니다.' })
    }
    } finally {
      this.signalsBusy.delete(lockKey)
    }
  }

  private async onQuote(quote: { environment: StrategyEnvironment; code: string; exchange: string; price: number }) {
    if (!this.feedHealth.get(quote.environment) || quote.price <= 0) return
    const key = positionKey({ ...quote, environment: quote.environment })
    this.latestQuotes.set(key, { price: quote.price, receivedAt: Date.now() })
    const current = await this.store.get()
    const state = current.positions.find((item) => positionKey(item) === key && item.status === 'monitoring')
    if (!state) return
    await this.evaluate(quote.environment, { ...state, currentPrice: quote.price }, state, current.settings, true)
  }

  private async onRealtimeOrder(order: { environment: StrategyEnvironment; code: string; exchange: string; orderNo: string; side: 'buy' | 'sell'; status: string; filledQuantity: number }) {
    if (order.side !== 'sell') return
    const key = positionKey(order)
    const current = await this.store.get()
    const state = current.positions.find((item) => positionKey(item) === key)
    if (!state || state.status === 'completed' || state.status === 'paused-failure' || state.status === 'paused-external-change') return
    if (state.orderNo && order.orderNo && state.orderNo.replace(/^0+/, '') === order.orderNo.replace(/^0+/, '')) return
    if (state.status === 'unknown' && state.intentId) {
      await this.patchPosition(state, { reason: '주문 응답과 실시간 매도 알림이 겹쳐 접수 여부를 REST로 확인 중입니다.' })
      return
    }
    await this.patchPosition(state, { status: 'paused-external-change', reason: `외부 매도 주문(${order.orderNo || order.status})을 감지했습니다. 계좌 확인 후 다시 켜 주세요.` })
  }

  private async onRealtimePosition(position: { environment: StrategyEnvironment; code: string; exchange: string; quantity: number; averagePrice: number }) {
    const key = positionKey(position)
    const current = await this.store.get()
    const state = current.positions.find((item) => positionKey(item) === key && item.status === 'monitoring')
    if (!state) return
    if (state.quantity !== position.quantity || (position.averagePrice > 0 && state.averagePrice !== position.averagePrice)) {
      await this.patchPosition(state, { status: 'paused-external-change', quantity: position.quantity, averagePrice: position.averagePrice, reason: '실시간 잔고 변경을 감지했습니다. 계좌 확인 후 다시 켜 주세요.' })
    }
  }

  private async reconcile(environment: StrategyEnvironment, position: StrategyPosition | null, state: PositionState) {
    const orders = await fetchStrategyOrders(this.env, environment as MockEnvironment, state.code)
    const normalizeOrderNo = (item: Record<string, unknown>) => String(item.ord_no ?? '').replace(/^0+/, '')
    let order = state.orderNo
      ? orders.find((item) => normalizeOrderNo(item) === state.orderNo?.replace(/^0+/, ''))
      : undefined
    if (!order && !state.orderNo) {
      const start = Date.parse(state.updatedAt) - 15_000
      const recent = orders.filter((item) => {
        const time = String(item.ord_tm ?? item.ord_time ?? '')
        const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time)
        if (!timeMatch) return false
        const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '')
        const when = new Date(`${nowParts.slice(0,4)}-${nowParts.slice(4,6)}-${nowParts.slice(6,8)}T${time}+09:00`).getTime()
        return when >= start && when <= Date.now() + 30_000
      })
      if (recent.length === 1) {
        order = recent[0]
        await this.patchPosition(state, { orderNo: normalizeOrderNo(order), status: 'pending', reason: '주문 내역에서 접수된 시장가 매도를 찾아 추적 중입니다.' })
        state = { ...state, orderNo: normalizeOrderNo(order), status: 'pending' }
      }
    }
    if (!order) return
    const overseas = environment === 'overseas-mock'
    const filled = positive(order.cntr_qty)
    const remaining = positive(order.ord_remnq)
    const status = String(overseas ? order.ord_stat_nm ?? '' : order.acpt_tp ?? '')
    if (remaining > 0) {
      await this.patchPosition(state, { status: 'pending', filledQuantity: filled, reason: `매도 주문 체결 확인 중 · ${filled}/${state.orderQuantity ?? 0}주` })
      return
    }
    if (filled >= (state.orderQuantity ?? Number.MAX_SAFE_INTEGER) && (!position || position.quantity === 0)) {
      await this.patchPosition(state, { status: 'completed', filledQuantity: filled, reason: '키움 주문 내역과 계좌 잔고에서 매도 완료를 확인했습니다.' })
      return
    }
      if (['취소완료', '무효주문', '거부', '취소확인'].some((label) => status.includes(label)) || remaining === 0) {
      await this.patchPosition(state, { status: 'paused-failure', filledQuantity: filled, reason: '주문이 종료되었거나 일부만 체결되었습니다. 자동 재주문은 하지 않았습니다.' })
    }
  }

  private async patchPosition(state: PositionState, patch: Partial<PositionState>) {
    const key = positionKey(state)
    await this.store.update((value) => ({ ...value, positions: value.positions.map((item) => positionKey(item) === key ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) }))
  }
}

export const createStrategyHandler = (runtime: StrategyRuntime) => async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url || '/', 'http://localhost')
  try {
    if (request.method === 'GET' && url.pathname === '/settings') return sendJson(response, 200, await runtime.settings())
    if (request.method === 'GET' && url.pathname === '/status') return sendJson(response, 200, await runtime.status())
    if (request.method === 'PUT' && url.pathname === '/settings') {
      let text = ''
      for await (const chunk of request) {
        text += chunk.toString()
        if (text.length > 1_000_000) return sendJson(response, 413, { message: '전략 설정이 너무 큽니다.' })
      }
      const data = JSON.parse(text) as { settings?: unknown }
      await runtime.saveSettings(JSON.stringify(data.settings))
      return sendJson(response, 200, await runtime.settings())
    }
    if (request.method === 'POST' && url.pathname === '/resume') {
      const environment = url.searchParams.get('environment')
      const code = url.searchParams.get('code') ?? ''
      const exchange = url.searchParams.get('exchange') ?? ''
      if ((environment !== 'domestic-mock' && environment !== 'overseas-mock') || !code || !exchange) return sendJson(response, 400, { message: '환경, 종목코드와 거래소를 확인해 주세요.' })
      await runtime.resume(environment, code, exchange)
      return sendJson(response, 200, await runtime.status())
    }
    return sendJson(response, 404, { message: '전략 API를 찾을 수 없습니다.' })
  } catch (error) {
    return sendJson(response, 400, { message: error instanceof Error ? error.message : '전략 요청을 처리하지 못했습니다.' })
  }
}
