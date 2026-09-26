import type { StockSearchItem } from './types.ts'

export const WATCHLIST_STORAGE_KEY = 'portfolio-desk.watchlist.v1'

export const stockKey = (stock: Pick<StockSearchItem, 'market' | 'code'>) => `${stock.market}:${stock.code}`

export function parseWatchlist(value: string | null): StockSearchItem[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StockSearchItem => {
      if (!item || typeof item !== 'object') return false
      const stock = item as Partial<StockSearchItem>
      return typeof stock.code === 'string' && typeof stock.name === 'string' && typeof stock.market === 'string'
    })
  } catch {
    return []
  }
}

export const updateWatchlist = (stocks: StockSearchItem[], stock: StockSearchItem) => {
  const key = stockKey(stock)
  return stocks.some((item) => stockKey(item) === key)
    ? stocks.filter((item) => stockKey(item) !== key)
    : [...stocks, stock]
}
