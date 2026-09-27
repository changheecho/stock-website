import type { StockSearchItem } from './types'

export type StrategyMarket = 'domestic' | 'overseas'
export type StrategyMarketCommonSettings = {
  enabled: boolean
  startTime: string
  endTime: string
  excludedStocks: StockSearchItem[]
}
export type StrategyMarketSettings = StrategyMarketCommonSettings & { takeProfitPercent: number; stopLossPercent: number }
export type TrailingStopMarketSettings = StrategyMarketCommonSettings & { activationProfitPercent: number; drawdownPercent: number }
export type ChartBarType = 'tick' | 'minute' | 'day' | 'week' | 'month'
export type DeadCrossMarketSettings = StrategyMarketCommonSettings & {
  barType: ChartBarType
  barInterval: number | null
  shortMAPeriod: number
  longMAPeriod: number
}
export type StrategySettingsDocument = {
  schemaVersion: 1
  strategies: {
    stopLossTakeProfit: Record<StrategyMarket, StrategyMarketSettings>
    trailingStop: Record<StrategyMarket, TrailingStopMarketSettings>
    deadCross: Record<StrategyMarket, DeadCrossMarketSettings>
    [strategyId: string]: unknown
  }
}

export const STRATEGY_SETTINGS_STORAGE_KEY = 'portfolio-desk.strategy-settings.v1'
export const MARKET_TRADING_HOURS: Record<StrategyMarket, { start: string; end: string; timeZone: string; label: string }> = {
  domestic: { start: '09:00', end: '15:30', timeZone: 'Asia/Seoul', label: '국내 정규장' },
  overseas: { start: '09:30', end: '16:00', timeZone: 'America/New_York', label: '미국 정규장' },
}

export const CHART_BAR_OPTIONS: Record<StrategyMarket, { type: ChartBarType; label: string; intervals?: number[] }[]> = {
  domestic: [
    { type: 'tick', label: '틱봉', intervals: [1, 3, 5, 10, 30] },
    { type: 'minute', label: '분봉', intervals: [1, 3, 5, 10, 15, 30, 45, 60] },
    { type: 'day', label: '일봉' },
    { type: 'week', label: '주봉' },
    { type: 'month', label: '월봉' },
  ],
  // The US chart specs describe minute/tick TRs but do not enumerate accepted tic_scope values.
  overseas: [
    { type: 'day', label: '일봉' },
    { type: 'week', label: '주봉' },
    { type: 'month', label: '월봉' },
  ],
}

export const createDefaultStrategySettings = (): StrategySettingsDocument => ({
  schemaVersion: 1,
  strategies: {
    stopLossTakeProfit: {
      domestic: { enabled: false, startTime: '09:00', endTime: '15:30', takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
      overseas: { enabled: false, startTime: '09:30', endTime: '16:00', takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
    },
    trailingStop: {
      domestic: { enabled: false, startTime: '09:00', endTime: '15:30', activationProfitPercent: 3, drawdownPercent: 1.5, excludedStocks: [] },
      overseas: { enabled: false, startTime: '09:30', endTime: '16:00', activationProfitPercent: 3, drawdownPercent: 1.5, excludedStocks: [] },
    },
    deadCross: {
      domestic: { enabled: false, startTime: '09:00', endTime: '15:30', barType: 'minute', barInterval: 5, shortMAPeriod: 5, longMAPeriod: 20, excludedStocks: [] },
      overseas: { enabled: false, startTime: '09:30', endTime: '16:00', barType: 'day', barInterval: null, shortMAPeriod: 5, longMAPeriod: 20, excludedStocks: [] },
    },
  },
})

const validateMarketWindow = (market: StrategyMarket, settings: Pick<StrategyMarketCommonSettings, 'startTime' | 'endTime'>) => {
  const hours = MARKET_TRADING_HOURS[market]
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!timePattern.test(settings.startTime) || !timePattern.test(settings.endTime)) return '시간을 올바르게 입력해 주세요.'
  if (settings.startTime < hours.start || settings.startTime >= hours.end || settings.endTime <= hours.start || settings.endTime > hours.end) {
    return `${hours.label} 시간(${hours.start}–${hours.end}) 안에서 설정해 주세요.`
  }
  if (settings.startTime >= settings.endTime) return '시작시간은 종료시간보다 앞서야 합니다.'
  return null
}

export const validateMarketSettings = (market: StrategyMarket, settings: StrategyMarketSettings) => {
  const windowError = validateMarketWindow(market, settings)
  if (windowError) return windowError
  if (![settings.takeProfitPercent, settings.stopLossPercent].every((value) => Number.isFinite(value) && value > 0 && value <= 100)) {
    return '익절·손절 기준은 0보다 크고 100 이하로 입력해 주세요.'
  }
  return null
}

export const validateTrailingStopSettings = (market: StrategyMarket, settings: TrailingStopMarketSettings) => {
  const windowError = validateMarketWindow(market, settings)
  if (windowError) return windowError
  if (![settings.activationProfitPercent, settings.drawdownPercent].every((value) => Number.isFinite(value) && value > 0 && value <= 100)) {
    return '활성화 수익률과 고점 대비 하락률은 0보다 크고 100 이하로 입력해 주세요.'
  }
  return null
}

export const validateDeadCrossSettings = (market: StrategyMarket, settings: DeadCrossMarketSettings, availableClosedBars?: number) => {
  const windowError = validateMarketWindow(market, settings)
  if (windowError) return windowError
  const option = CHART_BAR_OPTIONS[market].find((item) => item.type === settings.barType)
  if (!option) return '선택한 시장에서 명세로 확인된 봉 주기가 아닙니다.'
  if (option.intervals) {
    if (!Number.isInteger(settings.barInterval) || !option.intervals.includes(settings.barInterval as number)) {
      const unit = settings.barType === 'minute' ? '분' : '틱'
      return `명세에 기재된 ${unit} 단위 중에서 선택해 주세요.`
    }
  } else if (settings.barInterval !== null) return '일·주·월 봉 주기에는 별도 간격을 지정하지 않습니다.'
  if (![settings.shortMAPeriod, settings.longMAPeriod].every((value) => Number.isSafeInteger(value) && value >= 1)) {
    return '이동평균 기간은 1 이상의 정수 봉 개수로 입력해 주세요.'
  }
  if (settings.shortMAPeriod >= settings.longMAPeriod) return '단기 이동평균 기간은 장기 이동평균 기간보다 작아야 합니다.'
  if (availableClosedBars !== undefined && settings.longMAPeriod > availableClosedBars) {
    return `장기 이동평균 기간은 조회된 완료봉 ${availableClosedBars}개 이하여야 합니다.`
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

const isTrailingStopSettings = (market: StrategyMarket, value: unknown): value is TrailingStopMarketSettings => {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<TrailingStopMarketSettings>
  if (typeof settings.enabled !== 'boolean' || typeof settings.startTime !== 'string' || typeof settings.endTime !== 'string'
    || typeof settings.activationProfitPercent !== 'number' || typeof settings.drawdownPercent !== 'number'
    || !Array.isArray(settings.excludedStocks) || !settings.excludedStocks.every(isStockSearchItem)) return false
  return validateTrailingStopSettings(market, settings as TrailingStopMarketSettings) === null
}

const isDeadCrossSettings = (market: StrategyMarket, value: unknown): value is DeadCrossMarketSettings => {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<DeadCrossMarketSettings>
  if (typeof settings.enabled !== 'boolean' || typeof settings.startTime !== 'string' || typeof settings.endTime !== 'string'
    || typeof settings.barType !== 'string' || (settings.barInterval !== null && typeof settings.barInterval !== 'number')
    || typeof settings.shortMAPeriod !== 'number' || typeof settings.longMAPeriod !== 'number'
    || !Array.isArray(settings.excludedStocks) || !settings.excludedStocks.every(isStockSearchItem)) return false
  return validateDeadCrossSettings(market, settings as DeadCrossMarketSettings) === null
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
  const trailingStop = strategies.trailingStop
  const deadCross = strategies.deadCross
  if (!stopLossTakeProfit || typeof stopLossTakeProfit !== 'object') throw new Error('SL / TP 설정이 없습니다.')
  const settings = stopLossTakeProfit as Record<string, unknown>
  if (!isMarketSettings('domestic', settings.domestic) || !isMarketSettings('overseas', settings.overseas)) {
    throw new Error('국내·해외 SL / TP 설정 값이나 정규장 시간이 올바르지 않습니다.')
  }
  const defaults = createDefaultStrategySettings().strategies.trailingStop
  let normalizedTrailingStop = defaults
  if (trailingStop !== undefined) {
    if (!trailingStop || typeof trailingStop !== 'object') throw new Error('트레일링 스탑 설정 형식이 올바르지 않습니다.')
    const trailing = trailingStop as Record<string, unknown>
    if (!isTrailingStopSettings('domestic', trailing.domestic) || !isTrailingStopSettings('overseas', trailing.overseas)) {
      throw new Error('국내·해외 트레일링 스탑 설정 값이나 정규장 시간이 올바르지 않습니다.')
    }
    normalizedTrailingStop = { domestic: trailing.domestic, overseas: trailing.overseas }
  }
  const defaultDeadCross = createDefaultStrategySettings().strategies.deadCross
  let normalizedDeadCross = defaultDeadCross
  if (deadCross !== undefined) {
    if (!deadCross || typeof deadCross !== 'object') throw new Error('데드크로스 설정 형식이 올바르지 않습니다.')
    const deadCrossMarket = deadCross as Record<string, unknown>
    if (!isDeadCrossSettings('domestic', deadCrossMarket.domestic) || !isDeadCrossSettings('overseas', deadCrossMarket.overseas)) {
      throw new Error('국내·해외 데드크로스 설정 값이나 봉 주기가 올바르지 않습니다.')
    }
    normalizedDeadCross = { domestic: deadCrossMarket.domestic, overseas: deadCrossMarket.overseas }
  }
  return { schemaVersion: 1, strategies: { ...strategies, stopLossTakeProfit: { domestic: settings.domestic, overseas: settings.overseas }, trailingStop: normalizedTrailingStop, deadCross: normalizedDeadCross } }
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
