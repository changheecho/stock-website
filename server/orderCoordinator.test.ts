import assert from 'node:assert/strict'
import test from 'node:test'
import { withSellLock } from './orderCoordinator.ts'

test('sells for one symbol are serialized while different symbols can proceed independently', async () => {
  let active = 0
  let maxActive = 0
  const activeByKey = new Map<string, number>()
  const maxByKey = new Map<string, number>()
  const sell = (key: string) => withSellLock(key, async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    const activeForKey = (activeByKey.get(key) ?? 0) + 1
    activeByKey.set(key, activeForKey)
    maxByKey.set(key, Math.max(maxByKey.get(key) ?? 0, activeForKey))
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    activeByKey.set(key, activeForKey - 1)
  })
  await Promise.all([sell('mock:KRX:005930'), sell('mock:KRX:005930'), sell('mock:KRX:000660')])
  assert.equal(maxByKey.get('mock:KRX:005930'), 1)
  assert.equal(maxActive, 2)
})
