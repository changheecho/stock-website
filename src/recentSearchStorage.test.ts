import assert from 'node:assert/strict'
import test from 'node:test'
import { addRecentSearch, MAX_RECENT_SEARCHES, parseRecentSearches } from './recentSearchStorage.ts'

test('parses, normalizes, and limits stored searches', () => {
  const stored = JSON.stringify([' 삼성 ', 'AAPL', '삼성', ...Array.from({ length: 12 }, (_, index) => `item-${index}`)])
  const searches = parseRecentSearches(stored)

  assert.deepEqual(searches.slice(0, 2), ['삼성', 'AAPL'])
  assert.equal(searches.length, MAX_RECENT_SEARCHES)
  assert.deepEqual(parseRecentSearches('invalid'), [])
})

test('adds the newest search first without duplicates', () => {
  assert.deepEqual(addRecentSearch(['삼성전자', 'AAPL'], ' AAPL '), ['AAPL', '삼성전자'])
  assert.deepEqual(addRecentSearch(['삼성전자'], '  '), ['삼성전자'])
})
