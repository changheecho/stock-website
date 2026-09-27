import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultStrategySettings, loadStrategySettings, parseStrategySettings, serializeStrategySettings, validateMarketSettings,
} from './strategySettings.ts'

test('default SL/TP settings are disabled and use each market regular session', () => {
  const settings = createDefaultStrategySettings().strategies.stopLossTakeProfit
  assert.equal(settings.domestic.enabled, false)
  assert.equal(settings.domestic.startTime, '09:00')
  assert.equal(settings.domestic.endTime, '15:30')
  assert.equal(settings.overseas.startTime, '09:30')
  assert.equal(settings.overseas.endTime, '16:00')
})

test('market settings reject times outside regular hours and reversed ranges', () => {
  const defaults = createDefaultStrategySettings().strategies.stopLossTakeProfit
  assert.match(validateMarketSettings('domestic', { ...defaults.domestic, startTime: '08:59' }) ?? '', /정규장/)
  assert.match(validateMarketSettings('overseas', { ...defaults.overseas, endTime: '16:01' }) ?? '', /정규장/)
  assert.match(validateMarketSettings('domestic', { ...defaults.domestic, startTime: '14:00', endTime: '13:00' }) ?? '', /시작시간/)
  assert.equal(validateMarketSettings('overseas', defaults.overseas), null)
})

test('whole strategy JSON round trips and preserves other future strategies', () => {
  const settings = createDefaultStrategySettings() as ReturnType<typeof createDefaultStrategySettings> & { strategies: Record<string, unknown> }
  settings.strategies.futureStrategy = { enabled: true, custom: ['kept'] }
  const restored = parseStrategySettings(serializeStrategySettings(settings))
  assert.deepEqual(restored.strategies.futureStrategy, { enabled: true, custom: ['kept'] })
  assert.equal(restored.strategies.stopLossTakeProfit && typeof restored.strategies.stopLossTakeProfit, 'object')
})

test('import rejects malformed JSON and invalid market configuration', () => {
  assert.throws(() => parseStrategySettings('{bad'), /JSON/)
  const settings = createDefaultStrategySettings()
  settings.strategies.stopLossTakeProfit.domestic.startTime = '08:30'
  assert.throws(() => parseStrategySettings(JSON.stringify(settings)), /정규장/)
  assert.equal(loadStrategySettings('{invalid').schemaVersion, 1)
})
