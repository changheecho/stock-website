export const quantityForBudget = (budget: number, price: number, maxQuantity?: number) => {
  if (!Number.isFinite(budget) || !Number.isFinite(price) || budget <= 0 || price <= 0) return 0
  const quantity = Math.floor(budget / price)
  return maxQuantity === undefined ? quantity : Math.min(quantity, Math.max(0, Math.floor(maxQuantity)))
}
