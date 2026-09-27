import type { StockSearchItem } from './types'

export type StrategyMarket = 'domestic' | 'overseas'
export type StrategyMarketSettings = {
  enabled: boolean
  startTime: string
  endTime: string
  takeProfitPercent: number
  stopLossPercent: number
  excludedStocks: StockSearchItem[]
}
export type StrategySettingsDocument = {
  schemaVersion: 1
  strategies: {
    stopLossTakeProfit: Record<StrategyMarket, StrategyMarketSettings>
    [strategyId: string]: unknown
  }
}

export const STRATEGY_SETTINGS_STORAGE_KEY = 'portfolio-desk.strategy-settings.v1'
export const MARKET_TRADING_HOURS: Record<StrategyMarket, { start: string; end: string; timeZone: string; label: string }> = {
  domestic: { start: '09:00', end: '15:30', timeZone: 'Asia/Seoul', label: '국내 정규장' },
  overseas: { start: '09:30', end: '16:00', timeZone: 'America/New_York', label: '미국 정규장' },
}

export const createDefaultStrategySettings = (): StrategySettingsDocument => ({
  schemaVersion: 1,
  strategies: {
    stopLossTakeProfit: {
      domestic: { enabled: false, startTime: '09:00', endTime: '15:30', takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
      overseas: { enabled: false, startTime: '09:30', endTime: '16:00', takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
    },
  },
})

export const validateMarketSettings = (market: StrategyMarket, settings: StrategyMarketSettings) => {
  const hours = MARKET_TRADING_HOURS[market]
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!timePattern.test(settings.startTime) || !timePattern.test(settings.endTime)) return '시간을 올바르게 입력해 주세요.'
  if (settings.startTime < hours.start || settings.startTime >= hours.end || settings.endTime <= hours.start || settings.endTime > hours.end) {
    return `${hours.label} 시간(${hours.start}–${hours.end}) 안에서 설정해 주세요.`
  }
  if (settings.startTime >= settings.endTime) return '시작시간은 종료시간보다 앞서야 합니다.'
  if (![settings.takeProfitPercent, settings.stopLossPercent].every((value) => Number.isFinite(value) && value > 0 && value <= 100)) {
    return '익절·손절 기준은 0보다 크고 100 이하로 입력해 주세요.'
  }
  return null
}

const isStockSearchItem = (value: unknown): value is StockSearchItem => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StockSearchItem>
  return typeof item.code === 'string' && typeof item.name === 'string' && typeof item.market === 'string'
}

const isMarketSettings = (market: StrategyMarket, value: unknown): value is StrategyMarketSettings => {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<StrategyMarketSettings>
  if (typeof settings.enabled !== 'boolean' || typeof settings.startTime !== 'string' || typeof settings.endTime !== 'string'
    || typeof settings.takeProfitPercent !== 'number' || typeof settings.stopLossPercent !== 'number'
    || !Array.isArray(settings.excludedStocks) || !settings.excludedStocks.every(isStockSearchItem)) return false
  return validateMarketSettings(market, settings as StrategyMarketSettings) === null
}

export const parseStrategySettings = (text: string): StrategySettingsDocument => {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('JSON 형식이 올바르지 않습니다.') }
  if (!parsed || typeof parsed !== 'object') throw new Error('전략 설정 JSON 객체가 필요합니다.')
  const document = parsed as Record<string, unknown>
  if (document.schemaVersion !== 1 || !document.strategies || typeof document.strategies !== 'object') {
    throw new Error('지원하지 않는 전략 설정 파일입니다. schemaVersion 1을 확인해 주세요.')
  }
  const strategies = document.strategies as Record<string, unknown>
  const stopLossTakeProfit = strategies.stopLossTakeProfit
  if (!stopLossTakeProfit || typeof stopLossTakeProfit !== 'object') throw new Error('SL / TP 설정이 없습니다.')
  const settings = stopLossTakeProfit as Record<string, unknown>
  if (!isMarketSettings('domestic', settings.domestic) || !isMarketSettings('overseas', settings.overseas)) {
    throw new Error('국내·해외 SL / TP 설정 값이나 정규장 시간이 올바르지 않습니다.')
  }
  return { schemaVersion: 1, strategies: { ...strategies, stopLossTakeProfit: { domestic: settings.domestic, overseas: settings.overseas } } }
}

export const loadStrategySettings = (value: string | null) => {
  if (!value) return createDefaultStrategySettings()
  try { return parseStrategySettings(value) } catch { return createDefaultStrategySettings() }
}

export const serializeStrategySettings = (settings: StrategySettingsDocument) => `${JSON.stringify(settings, null, 2)}\n`

export const marketCurrentTime = (market: StrategyMarket, now = new Date()) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: MARKET_TRADING_HOURS[market].timeZone,
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(now)
