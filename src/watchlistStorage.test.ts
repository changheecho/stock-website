import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWatchlist, stockKey, updateWatchlist } from './watchlistStorage.ts'

const samsung = { code: '005930', name: '삼성전자', market: 'KRX' }

test('관심종목 JSON을 검증하고 잘못된 값은 버린다', () => {
  assert.deepEqual(parseWatchlist(JSON.stringify([samsung, { code: 3 }, null])), [samsung])
  assert.deepEqual(parseWatchlist('{invalid'), [])
})

test('같은 시장과 종목코드를 기준으로 추가하고 삭제한다', () => {
  const added = updateWatchlist([], samsung)
  assert.deepEqual(added, [samsung])
  assert.deepEqual(updateWatchlist(added, samsung), [])
  assert.notEqual(stockKey(samsung), stockKey({ ...samsung, market: 'NASDAQ' }))
})
