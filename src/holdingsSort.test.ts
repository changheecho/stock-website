import assert from 'node:assert/strict'
import test from 'node:test'
import { sortHoldings, type HoldingSortKey } from './holdingsSort.ts'
import type { Holding } from './types.ts'

const holdings: Holding[] = [
  { code: 'B', name: '한빛', quantity: 1, availableQuantity: 1, purchasePrice: 100, currentPrice: 80, evaluationAmount: 80, profitLoss: -20, returnRate: -20 },
  { code: 'A', name: '가람', quantity: 1, availableQuantity: 1, purchasePrice: 100, currentPrice: 120, evaluationAmount: 120, profitLoss: 20, returnRate: 20 },
  { code: 'C', name: '다온', quantity: 1, availableQuantity: 1, purchasePrice: 100, currentPrice: 100, evaluationAmount: 100, profitLoss: 0, returnRate: 0 },
]

for (const [key, ascending] of [
  ['name', ['A', 'C', 'B']],
  ['evaluationAmount', ['B', 'C', 'A']],
  ['profitLoss', ['B', 'C', 'A']],
  ['returnRate', ['B', 'C', 'A']],
] as [HoldingSortKey, string[]][]) {
  test(`${key} 기준으로 오름차순과 내림차순 정렬한다`, () => {
    assert.deepEqual(sortHoldings(holdings, key, 'ascending').map(({ code }) => code), ascending)
    assert.deepEqual(sortHoldings(holdings, key, 'descending').map(({ code }) => code), [...ascending].reverse())
    assert.deepEqual(holdings.map(({ code }) => code), ['B', 'A', 'C'])
  })
}
