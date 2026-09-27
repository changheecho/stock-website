import { FormEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Plus, Search, Trash2 } from 'lucide-react'
import { searchStocks } from './api'
import { CHART_BAR_OPTIONS, MARKET_TRADING_HOURS, type ChartBarType, type StrategyMarket } from './strategySettings'
import type { Environment, StockSearchItem } from './types'

export function MarketTabs({ market, environment, onChange }: { market: StrategyMarket; environment: Environment; onChange: (market: StrategyMarket) => void }) {
  const domesticDisabled = environment === 'overseas-mock'
  const overseasDisabled = environment === 'domestic-mock'
  return <div className="strategy-market-tabs" role="tablist" aria-label="전략 시장 선택">
    <button type="button" role="tab" aria-selected={market === 'domestic'} className={market === 'domestic' ? 'active' : ''} disabled={domesticDisabled} onClick={() => onChange('domestic')}>국내</button>
    <button type="button" role="tab" aria-selected={market === 'overseas'} className={market === 'overseas' ? 'active' : ''} disabled={overseasDisabled} onClick={() => onChange('overseas')}>해외</button>
  </div>
}

export function StrategyToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="strategy-enabled-toggle"><span><b>기능 사용</b><small>{checked ? '모의 계좌에서 전략 조건을 감시합니다.' : '설정 꺼짐'}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}

export function StrategyTimeRange({ market, startTime, endTime, onChange }: {
  market: StrategyMarket; startTime: string; endTime: string; onChange: (key: 'startTime' | 'endTime', value: string) => void
}) {
  const hours = MARKET_TRADING_HOURS[market]
  return <div className="strategy-time-range">
    <label>시작시간<input type="time" min={hours.start} max={hours.end} step={60} value={startTime} onChange={(event) => onChange('startTime', event.target.value)} /></label>
    <span aria-hidden="true">~</span>
    <label>종료시간<input type="time" min={hours.start} max={hours.end} step={60} value={endTime} onChange={(event) => onChange('endTime', event.target.value)} /></label>
  </div>
}

export function ChartPeriodSettings({ market, barType, barInterval, onChange }: {
  market: StrategyMarket; barType: ChartBarType; barInterval: number | null; onChange: (type: ChartBarType, interval: number | null) => void
}) {
  const options = CHART_BAR_OPTIONS[market]
  const selectedOption = options.find((option) => option.type === barType) ?? options[0]
  return <div className="chart-period-settings">
    <label>봉 종류<select value={selectedOption.type} onChange={(event) => {
      const selected = options.find((option) => option.type === event.target.value) ?? options[0]
      onChange(selected.type, selected.intervals?.[0] ?? null)
    }}>{options.map((option) => <option key={option.type} value={option.type}>{option.label}</option>)}</select></label>
    {selectedOption.intervals && <label>{barType === 'minute' ? '분 단위' : '틱 단위'}<select value={barInterval ?? ''} onChange={(event) => onChange(barType, Number(event.target.value))}>{selectedOption.intervals.map((interval) => <option key={interval} value={interval}>{interval}{barType === 'minute' ? '분' : '틱'}</option>)}</select></label>}
  </div>
}

export function ExcludedStocks({ market, environment, stocks, onAdd, onRemove }: {
  market: StrategyMarket; environment: Environment; stocks: StockSearchItem[]; onAdd: (stock: StockSearchItem) => void; onRemove: (stock: StockSearchItem) => void
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const searchEnvironment = (market + '-' + (environment.endsWith('-live') ? 'live' : 'mock')) as Environment
  const result = useQuery({
    queryKey: ['strategy-excluded-stock-search', searchEnvironment, query],
    queryFn: () => searchStocks(searchEnvironment, query),
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = input.trim()
    if (normalized) setQuery(normalized)
  }
  const add = (stock: StockSearchItem) => {
    if (!stocks.some((item) => item.code === stock.code && item.market === stock.market)) onAdd(stock)
  }

  return <section className="strategy-exclusions">
    <div className="strategy-section-title"><div><h3>제외종목</h3><p>자동매도 대상에서 제외할 종목을 선택합니다.</p></div><span>{stocks.length}개</span></div>
    <form className="strategy-search" onSubmit={submit}>
      <Search size={17} /><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={market === 'domestic' ? '종목명 또는 코드 검색' : '종목명 또는 티커 검색'} aria-label="제외종목 검색" />
      {result.isFetching && <LoaderCircle className="spin" size={16} />}<button type="submit" disabled={!input.trim() || result.isFetching}>검색</button>
    </form>
    {result.isError && <p className="strategy-search-error">{result.error.message}</p>}
    {result.data && result.data.length > 0 && <ul className="strategy-search-results">{result.data.map((stock) => {
      const exists = stocks.some((item) => item.code === stock.code && item.market === stock.market)
      return <li key={stock.market + '-' + stock.code}><span><b>{stock.name || stock.englishName || stock.code}</b><small>{stock.code} · {stock.market}</small></span><button type="button" onClick={() => add(stock)} disabled={exists} aria-label={stock.code + ' 제외 목록에 추가'}><Plus size={15} />{exists ? '추가됨' : '추가'}</button></li>
    })}</ul>}
    {stocks.length > 0 ? <ul className="excluded-stock-list">{stocks.map((stock) => <li key={stock.market + '-' + stock.code}><span><b>{stock.name || stock.code}</b><small>{stock.code} · {stock.market}</small></span><button type="button" onClick={() => onRemove(stock)} aria-label={stock.code + ' 제외 목록에서 삭제'}><Trash2 size={15} />삭제</button></li>)}</ul> : <div className="excluded-stock-empty">제외종목이 없습니다.</div>}
  </section>
}
