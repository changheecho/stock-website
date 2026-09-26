import assert from 'node:assert/strict'
import test from 'node:test'
import { quantityForBudget } from './orderQuantity.ts'

test('calculates whole shares without exceeding a KRW budget', () => {
  assert.equal(quantityForBudget(100_000, 31_000), 3)
})

test('uses a USD budget directly and does not apply an exchange rate', () => {
  assert.equal(quantityForBudget(500, 125.5), 3)
})

test('caps an automatically calculated sell quantity at the available quantity', () => {
  assert.equal(quantityForBudget(1_000_000, 10_000, 12), 12)
})

test('returns zero for invalid budgets or prices', () => {
  assert.equal(quantityForBudget(100_000, 0), 0)
  assert.equal(quantityForBudget(0, 10_000), 0)
})
