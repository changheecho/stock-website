import type { Holding } from './types'

export type HoldingSortKey = 'name' | 'evaluationAmount' | 'profitLoss' | 'returnRate'
export type SortDirection = 'ascending' | 'descending'

export function sortHoldings(holdings: Holding[], key: HoldingSortKey, direction: SortDirection) {
  const multiplier = direction === 'ascending' ? 1 : -1

  return holdings
    .map((holding, index) => ({ holding, index }))
    .sort((left, right) => {
      const comparison = key === 'name'
        ? (left.holding.name || left.holding.code).localeCompare(
            right.holding.name || right.holding.code,
            'ko',
            { numeric: true, sensitivity: 'base' },
          )
        : left.holding[key] - right.holding[key]

      return comparison === 0 ? left.index - right.index : comparison * multiplier
    })
    .map(({ holding }) => holding)
}
