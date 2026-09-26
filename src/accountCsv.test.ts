import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountCsv, createAccountCsvFilename } from './accountCsv.ts'
import type { AccountView } from './types.ts'

const account: AccountView = {
  currency: 'KRW',
  totalPurchase: 10000,
  totalEvaluation: 12000,
  totalProfitLoss: 2000,
  totalReturnRate: 20,
  cashBalance: 3000,
  cashCurrency: 'KRW',
  availableAmount: 3000,
  availableCurrency: 'KRW',
  availableLabel: '주문 가능 금액',
  holdings: [{
    code: '005930',
    name: '삼성전자, "우"',
    exchange: 'KRX',
    quantity: 2,
    availableQuantity: 1,
    purchasePrice: 5000,
    currentPrice: 6000,
    evaluationAmount: 12000,
    profitLoss: 2000,
    returnRate: 20,
  }],
}

test('account CSV includes a UTF-8 BOM, escaped holdings, and profit/loss totals', () => {
  const csv = createAccountCsv(account)

  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /"삼성전자, ""우"""/)
  assert.match(csv, /"005930","삼성전자, ""우""","KRX","2","1","5000","6000","10000","12000","2000","20","KRW"/)
  assert.match(csv, /"합계".*"10000","12000","2000","20","KRW"\r\n$/)
})

test('account CSV neutralizes values that spreadsheet apps could execute as formulas', () => {
  const csv = createAccountCsv({
    ...account,
    holdings: [{ ...account.holdings[0], name: '=HYPERLINK("bad")' }],
  })

  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/)
})

test('CSV filename identifies the environment and local export date', () => {
  assert.equal(createAccountCsvFilename('domestic-mock', new Date(2026, 8, 26)), 'portfolio-domestic-mock-2026-09-26.csv')
})
