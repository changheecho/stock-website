import type { AccountView } from './types'

const UTF8_BOM = '\uFEFF'

function csvCell(value: string | number) {
  const text = String(value)
  const safeText = typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

export function createAccountCsv(account: AccountView) {
  const rows: (string | number)[][] = [
    ['종목코드', '종목명', '거래소', '보유수량', '매도가능수량', '평균단가', '현재가', '매입금액', '평가금액', '평가손익', '수익률(%)', '통화'],
    ...account.holdings.map((holding) => [
      holding.code,
      holding.name,
      holding.exchange ?? '',
      holding.quantity,
      holding.availableQuantity,
      holding.purchasePrice,
      holding.currentPrice,
      holding.purchasePrice * holding.quantity,
      holding.evaluationAmount,
      holding.profitLoss,
      holding.returnRate,
      account.currency,
    ]),
    ['', '합계', '', '', '', '', '', account.totalPurchase, account.totalEvaluation, account.totalProfitLoss, account.totalReturnRate, account.currency],
  ]

  return UTF8_BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function createAccountCsvFilename(environment: string, now = new Date()) {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
  return `portfolio-${environment}-${date}.csv`
}
