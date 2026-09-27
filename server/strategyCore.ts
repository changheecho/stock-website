import type { StrategySettingsDocument, StrategyMarketSettings, TrailingStopMarketSettings, DeadCrossMarketSettings } from '../src/strategySettings.ts'
import { sellLockKey } from './orderCoordinator.ts'

export type StrategyId = 'stopLossTakeProfit' | 'trailingStop' | 'deadCross'
export type StrategyEnvironment = 'domestic-mock' | 'overseas-mock'
export type StrategyPosition = { code: string; exchange: string; quantity: number; availableQuantity: number; averagePrice: number; currentPrice: number }
export type StrategyKey = { environment: StrategyEnvironment; code: string; exchange: string }
export type PositionState = StrategyKey & {
  status: 'monitoring' | 'pending' | 'unknown' | 'paused-external-change' | 'paused-failure' | 'completed'
  quantity: number
  availableQuantity: number
  averagePrice: number
  peakPrice: number
  lastBarKey?: string
  intentId?: string
  orderNo?: string
  orderQuantity?: number
  filledQuantity?: number
  triggeredBy?: StrategyId[]
  reason?: string
  updatedAt: string
}

type ThresholdStrategy = StrategyMarketSettings
type TrailingStrategy = TrailingStopMarketSettings
type CrossoverStrategy = DeadCrossMarketSettings

export const normalizeStockCode = (value: string, overseas: boolean) => overseas ? value.trim().toUpperCase() : value.trim().replace(/^[AJQ]/, '')
export const positionKey = ({ environment, code, exchange }: StrategyKey) => sellLockKey(environment, exchange, normalizeStockCode(code, environment === 'overseas-mock'))

export function detectThreshold(settings: ThresholdStrategy, averagePrice: number, currentPrice: number): 'take-profit' | 'stop-loss' | null {
  if (!settings.enabled || averagePrice <= 0 || currentPrice <= 0) return null
  const rate = (currentPrice - averagePrice) / averagePrice * 100
  if (rate >= settings.takeProfitPercent) return 'take-profit'
  if (rate <= -settings.stopLossPercent) return 'stop-loss'
  return null
}

export function updateTrailingPeak(settings: TrailingStrategy, averagePrice: number, currentPrice: number, peakPrice: number) {
  if (!settings.enabled || averagePrice <= 0 || currentPrice <= 0) return { peakPrice, triggered: false }
  const nextPeak = Math.max(peakPrice, currentPrice)
  const active = (nextPeak - averagePrice) / averagePrice * 100 >= settings.activationProfitPercent
  const pulledBack = (nextPeak - currentPrice) / nextPeak * 100 >= settings.drawdownPercent
  return { peakPrice: nextPeak, triggered: active && pulledBack }
}

export type ClosedBar = { key: string; close: number }
export function detectDeadCross(settings: CrossoverStrategy, barsNewestFirst: ClosedBar[], lastConsumedBarKey?: string) {
  if (!settings.enabled || barsNewestFirst.length < settings.longMAPeriod + 2) return { triggered: false, barKey: lastConsumedBarKey }
  // The newest API candle may still be forming. Never use it for a cross decision.
  const bars = barsNewestFirst.slice(1).reverse()
  const latestKey = bars.at(-1)?.key
  if (!latestKey || latestKey === lastConsumedBarKey || bars.length < settings.longMAPeriod + 1) return { triggered: false, barKey: lastConsumedBarKey }
  const short = settings.shortMAPeriod
  const long = settings.longMAPeriod
  const previous = bars.slice(-long - 1, -1)
  const current = bars.slice(-long)
  if (previous.length < long || current.length < long) return { triggered: false, barKey: latestKey }
  const average = (slice: ClosedBar[], length: number) => slice.slice(-length).reduce((sum, bar) => sum + bar.close, 0) / length
  const previousShort = average(previous, short)
  const previousLong = average(previous, long)
  const currentShort = average(current, short)
  const currentLong = average(current, long)
  return { triggered: previousShort >= previousLong && currentShort < currentLong, barKey: latestKey }
}

export function eligibleSettings(document: StrategySettingsDocument, environment: StrategyEnvironment, position: StrategyPosition) {
  const market = environment.startsWith('overseas-') ? 'overseas' : 'domestic'
  const strategies = document.strategies
  const list: Array<{ id: StrategyId; settings: ThresholdStrategy | TrailingStrategy | CrossoverStrategy }> = [
    { id: 'stopLossTakeProfit', settings: strategies.stopLossTakeProfit[market] },
    { id: 'trailingStop', settings: strategies.trailingStop[market] },
    { id: 'deadCross', settings: strategies.deadCross[market] },
  ]
  return list.filter(({ settings }) => settings.enabled && !settings.excludedStocks.some((stock) => normalizeStockCode(stock.code, market === 'overseas') === normalizeStockCode(position.code, market === 'overseas') && stock.market === position.exchange))
}

export function hasEnabledStrategy(document: StrategySettingsDocument, environment: StrategyEnvironment, position: StrategyPosition) {
  return eligibleSettings(document, environment, position).length > 0
}

export function positionChanged(state: PositionState, position: StrategyPosition) {
  return state.quantity !== position.quantity || state.averagePrice !== position.averagePrice
}
