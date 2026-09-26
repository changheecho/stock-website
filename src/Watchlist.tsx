import { useEffect, useState } from 'react'
import { Building2, Star } from 'lucide-react'
import type { StockSearchItem } from './types'
import { parseWatchlist, stockKey, updateWatchlist, WATCHLIST_STORAGE_KEY } from './watchlistStorage'

export function useWatchlist() {
  const [stocks, setStocks] = useState<StockSearchItem[]>(() => parseWatchlist(localStorage.getItem(WATCHLIST_STORAGE_KEY)))

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === WATCHLIST_STORAGE_KEY) setStocks(parseWatchlist(event.newValue))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const toggle = (stock: StockSearchItem) => setStocks((current) => {
    const next = updateWatchlist(current, stock)
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
    return next
  })

  return { stocks, toggle, contains: (stock: StockSearchItem) => stocks.some((item) => stockKey(item) === stockKey(stock)) }
}

export function WatchlistButton({ stock, selected, onToggle }: { stock: StockSearchItem; selected: boolean; onToggle: (stock: StockSearchItem) => void }) {
  return <button className={`watchlist-toggle ${selected ? 'selected' : ''}`} onClick={() => onToggle(stock)} aria-label={`${stock.name || stock.code} 관심종목 ${selected ? '삭제' : '추가'}`} aria-pressed={selected} title={selected ? '관심종목에서 삭제' : '관심종목에 추가'}>
    <Star size={17} fill={selected ? 'currentColor' : 'none'} />
  </button>
}

export function WatchlistPage({ stocks, onToggle, onSelectStock }: { stocks: StockSearchItem[]; onToggle: (stock: StockSearchItem) => void; onSelectStock: (stock: StockSearchItem) => void }) {
  return <>
    <section className="page-heading"><div><div className="eyebrow"><Star size={12} fill="currentColor" />나만의 목록</div><h1>관심종목</h1><p>브라우저에 저장한 종목을 한곳에서 확인하세요.</p></div></section>
    {!stocks.length ? <div className="search-message watchlist-empty"><Star size={28} /><div><b>저장한 관심종목이 없습니다</b><span>종목 검색이나 순위 화면에서 별을 눌러 추가해 보세요.</span></div></div> : <section className="search-results watchlist-results">
      <div className="result-heading"><div><h2>저장된 종목</h2><p>이 브라우저에만 저장됩니다.</p></div><span>{stocks.length}개</span></div>
      <ul>{stocks.map((stock) => <li key={stockKey(stock)}>
        <button className="stock-result-button" onClick={() => onSelectStock(stock)} aria-label={`${stock.name || stock.code} 종목 정보 열기`}>
          <span className="stock-symbol"><Building2 size={18} /></span>
          <div className="result-name"><b>{stock.name || stock.englishName || stock.code}</b>{stock.englishName && <span>{stock.englishName}</span>}</div>
          <div className="result-meta"><b>{stock.code}</b><span>{stock.market}{stock.sector ? ` · ${stock.sector}` : ''}</span></div>
        </button>
        <WatchlistButton stock={stock} selected onToggle={onToggle} />
      </li>)}</ul>
    </section>}
  </>
}
