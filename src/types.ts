export type Environment = 'live' | 'domestic-mock' | 'overseas-mock'

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
