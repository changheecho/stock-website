import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultStrategySettings } from '../src/strategySettings.ts'
import { detectDeadCross, detectThreshold, updateTrailingPeak } from './strategyCore.ts'

test('SL / TP compares the current price with average purchase price', () => {
  const settings = { ...createDefaultStrategySettings().strategies.stopLossTakeProfit.domestic, enabled: true }
  assert.equal(detectThreshold(settings, 100, 105.1), 'take-profit')
  assert.equal(detectThreshold(settings, 100, 97), 'stop-loss')
  assert.equal(detectThreshold(settings, 100, 102), null)
})

test('trailing stop tracks the peak and waits for activation before a drawdown', () => {
  const settings = { ...createDefaultStrategySettings().strategies.trailingStop.domestic, enabled: true }
  assert.deepEqual(updateTrailingPeak(settings, 100, 102, 102), { peakPrice: 102, triggered: false })
  assert.deepEqual(updateTrailingPeak(settings, 100, 105, 102), { peakPrice: 105, triggered: false })
  assert.deepEqual(updateTrailingPeak(settings, 100, 103, 105), { peakPrice: 105, triggered: true })
})

test('dead cross ignores the forming candle and consumes each completed candle once', () => {
  const settings = { ...createDefaultStrategySettings().strategies.deadCross.domestic, enabled: true, shortMAPeriod: 2, longMAPeriod: 3 }
  const newestFirst = [
    { key: 'forming', close: 200 },
    { key: 'b5', close: 8 }, { key: 'b4', close: 10 }, { key: 'b3', close: 10 },
    { key: 'b2', close: 10 }, { key: 'b1', close: 10 },
  ]
  assert.deepEqual(detectDeadCross(settings, newestFirst), { triggered: true, barKey: 'b5' })
  assert.deepEqual(detectDeadCross(settings, newestFirst, 'b5'), { triggered: false, barKey: 'b5' })
  assert.equal(detectDeadCross(settings, newestFirst.slice(0, 4)).triggered, false)
})
