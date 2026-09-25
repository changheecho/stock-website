import { useMemo, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { sortHoldings, type HoldingSortKey, type SortDirection } from './holdingsSort'
import type { AccountView, Holding } from './types'

type Props = {
  holdings: Holding[]
  currency: AccountView['currency']
  onSell: (holding: Holding) => void
  tradingEnabled: boolean
}

const sortableColumns: { key: HoldingSortKey; label: string }[] = [
  { key: 'name', label: '종목' },
  { key: 'evaluationAmount', label: '평가 금액' },
  { key: 'profitLoss', label: '평가 손익' },
  { key: 'returnRate', label: '수익률' },
]

const formatMoney = (value: number, currency: AccountView['currency']) =>
  new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2,
  }).format(value)

const formatNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits }).format(value)

function ChangeValue({ value, currency }: { value: number; currency?: AccountView['currency'] }) {
  return <span className={`change ${value >= 0 ? 'positive' : 'negative'}`}>
    {currency ? formatMoney(Math.abs(value), currency) : `${formatNumber(Math.abs(value), 2)}%`}
  </span>
}

export default function HoldingsTable({ holdings, currency, onSell, tradingEnabled }: Props) {
  const [sort, setSort] = useState<{ key: HoldingSortKey; direction: SortDirection } | null>(null)
  const sortedHoldings = useMemo(
    () => sort ? sortHoldings(holdings, sort.key, sort.direction) : holdings,
    [holdings, sort],
  )
  const changeSort = (key: HoldingSortKey) => setSort((current) => ({
    key,
    direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
  }))
  const sortableHeader = (key: HoldingSortKey, label: string) => {
    const active = sort?.key === key
    const Icon = !active ? ChevronsUpDown : sort.direction === 'ascending' ? ChevronUp : ChevronDown
    return <th aria-sort={active ? sort.direction : 'none'}>
      <button className="sort-button" type="button" onClick={() => changeSort(key)}>
        {label}<Icon size={13} aria-hidden="true" />
      </button>
    </th>
  }

  if (!holdings.length) return <div className="empty-state">
    <BriefcaseBusiness size={28} />
    <h3>보유 종목이 없습니다</h3>
    <p>선택한 계좌에 보유 중인 종목이 없습니다.</p>
  </div>

  return <div className="table-scroll"><table>
    <thead><tr>
      {sortableHeader(sortableColumns[0].key, sortableColumns[0].label)}
      <th>보유 수량</th><th>평균 단가</th><th>현재가</th>
      {sortableColumns.slice(1).map(({ key, label }) => sortableHeader(key, label))}
      <th>거래</th>
    </tr></thead>
    <tbody>{sortedHoldings.map((holding) => <tr key={`${holding.code}-${holding.purchasePrice}`}>
      <td><div className="stock-name"><span className="ticker">{holding.code.slice(0, 2)}</span><div><b>{holding.name || holding.code}</b><small>{holding.code}{holding.exchange ? ` · ${holding.exchange}` : ''}</small></div></div></td>
      <td>{formatNumber(holding.quantity, 4)}주<small className="sub-value">매도 가능 {formatNumber(holding.availableQuantity, 4)}</small></td>
      <td>{formatMoney(holding.purchasePrice, currency)}</td>
      <td>{formatMoney(holding.currentPrice, currency)}</td>
      <td>{formatMoney(holding.evaluationAmount, currency)}</td>
      <td><ChangeValue value={holding.profitLoss} currency={currency} /></td>
      <td><ChangeValue value={holding.returnRate} /></td>
      <td><button className="sell-action" onClick={() => onSell(holding)} disabled={!tradingEnabled || holding.availableQuantity <= 0}>{tradingEnabled ? '매도' : '조회 전용'}</button></td>
    </tr>)}</tbody>
  </table></div>
}
