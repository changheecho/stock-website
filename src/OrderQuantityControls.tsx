import { useState } from 'react'
import { quantityForBudget } from './orderQuantity'

type Props = {
  currency: 'KRW' | 'USD'
  price: number
  quantity: string
  maxQuantity?: number
  disabled?: boolean
  onChange: (quantity: string) => void
}

export default function OrderQuantityControls({ currency, price, quantity, maxQuantity, disabled, onChange }: Props) {
  const [usdBudget, setUsdBudget] = useState('')
  const numericQuantity = Number(quantity)
  const setSteppedQuantity = (difference: number) => {
    const current = Number.isInteger(numericQuantity) ? numericQuantity : 0
    const next = Math.max(1, current + difference)
    onChange(String(maxQuantity === undefined ? next : Math.min(next, maxQuantity)))
  }
  const applyBudget = (budget: number) => onChange(String(quantityForBudget(budget, price, maxQuantity)))

  return <>
    <div className="quantity-stepper" aria-label="주문 수량 조절">
      <button type="button" onClick={() => setSteppedQuantity(-1)} disabled={disabled || numericQuantity <= 1} aria-label="수량 1 감소">−1</button>
      <button type="button" onClick={() => setSteppedQuantity(1)} disabled={disabled || (maxQuantity !== undefined && numericQuantity >= maxQuantity)} aria-label="수량 1 증가">+1</button>
    </div>
    {currency === 'KRW' ? <div className="budget-controls" aria-label="예산별 수량 자동 계산">
      {[100_000, 500_000, 1_000_000].map((budget) => <button type="button" key={budget} disabled={disabled || price <= 0 || quantityForBudget(budget, price, maxQuantity) < 1} onClick={() => applyBudget(budget)}>{budget / 10_000}만원</button>)}
    </div> : <label className="usd-budget">USD 예산
      <div><input type="number" min="0.01" step="0.01" placeholder="USD 금액 입력" value={usdBudget} onChange={(event) => setUsdBudget(event.target.value)} disabled={disabled} /><button type="button" disabled={disabled || quantityForBudget(Number(usdBudget), price, maxQuantity) < 1} onClick={() => applyBudget(Number(usdBudget))}>수량 계산</button></div>
      <small>환율을 적용하지 않고 입력한 USD 예산으로 계산합니다.</small>
    </label>}
  </>
}
