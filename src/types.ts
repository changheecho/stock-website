export type Environment = 'domestic-live' | 'overseas-live' | 'domestic-mock' | 'overseas-mock'
export type MockEnvironment = Extract<Environment, `${string}-mock`>
export type Feature = 'account' | 'stock-search' | 'rankings'
export type TradeSide = 'buy' | 'sell'
export type TradeSelection = { stock: StockSearchItem; side: TradeSide; availableQuantity?: number }

export type StockSearchItem = {
  code: string
  name: string
  englishName?: string
  market: string
  sector?: string
  status?: string
  isEtf?: boolean
}

export type StockQuote = {
  code: string
  name: string
  englishName?: string
  currency: 'KRW' | 'USD'
  currentPrice: number
  change: number
  changeRate: number
  volume: number
  high: number
  low: number
  canBuy: boolean
  unavailableReason?: string
}

export type OrderReceipt = { orderNo: string; name: string; status: 'accepted'; message: string }
export type OrderStatus = { state: 'checking' | 'pending' | 'filled'; label: string; filledQuantity: number; remainingQuantity: number; filledPrice?: number }

export type RankingItem = { rank: number; code: string; name: string; englishName?: string; market: string; price: number; changeRate: number; metric: number; metricLabel: string }
export type RankingsData = { value: RankingItem[]; gainers: RankingItem[]; volume: RankingItem[]; popular: RankingItem[] }

export type Holding = {
  code: string
  name: string
  quantity: number
  availableQuantity: number
  purchasePrice: number
  currentPrice: number
  evaluationAmount: number
  profitLoss: number
  returnRate: number
  weight?: number
  exchange?: string
}

export type AccountView = {
  currency: 'KRW' | 'USD'
  totalPurchase: number
  totalEvaluation: number
  totalProfitLoss: number
  totalReturnRate: number
  estimatedAssets?: number
  cashBalance: number
  cashCurrency: 'KRW' | 'USD'
  availableAmount: number
  availableCurrency: 'KRW' | 'USD'
  availableLabel: string
  holdings: Holding[]
}
