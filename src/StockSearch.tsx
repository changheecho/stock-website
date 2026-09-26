import { FormEvent, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Building2, LoaderCircle, Search, SearchX } from 'lucide-react'
import { searchStocks } from './api'
import RecentSearches from './RecentSearches'
import { addRecentSearch, parseRecentSearches, RECENT_SEARCHES_KEY } from './recentSearchStorage'
import type { Environment, StockSearchItem } from './types'
import { WatchlistButton } from './Watchlist'

type Props = { environment: Environment; onSelectStock: (stock: StockSearchItem) => void; isWatchlisted: (stock: StockSearchItem) => boolean; onToggleWatchlist: (stock: StockSearchItem) => void }

export default function StockSearch({ environment, onSelectStock, isWatchlisted, onToggleWatchlist }: Props) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState(() => parseRecentSearches(localStorage.getItem(RECENT_SEARCHES_KEY)))
  const isDomestic = environment.startsWith('domestic-')
  const isLive = environment.endsWith('-live')
  const result = useQuery({
    queryKey: ['stock-search', environment, query],
    queryFn: () => searchStocks(environment, query),
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => { setInput(''); setQuery('') }, [environment])

  const saveRecentSearches = (searches: string[]) => {
    setRecentSearches(searches)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))
  }

  const search = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return
    setInput(normalized)
    setQuery(normalized)
    saveRecentSearches(addRecentSearch(recentSearches, normalized))
  }

  const submit = (event: FormEvent) => { event.preventDefault(); search(input) }
  const removeRecentSearch = (value: string) => saveRecentSearches(recentSearches.filter((item) => item !== value))
  const clearRecentSearches = () => { setRecentSearches([]); localStorage.removeItem(RECENT_SEARCHES_KEY) }

  return <>
    <section className="page-heading search-heading">
      <div><div className="eyebrow"><span className="live-dot" />종목 탐색</div><h1>종목 검색</h1><p>종목명이나 종목코드로 원하는 종목을 찾아보세요.</p></div>
    </section>

    <section className="search-card">
      <div className="market-tabs" aria-label="검색 시장 선택">
        <button className={isDomestic ? 'active' : ''} disabled={!isDomestic}>국내 <small>코스피 · 코스닥</small></button>
        <button className={!isDomestic ? 'active' : ''} disabled={isDomestic}>해외 <small>NASDAQ · NYSE · AMEX</small></button>
      </div>
      <form className="search-form" onSubmit={submit}>
        <Search size={20} />
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={isDomestic ? '예: 삼성전자 또는 005930' : '예: Apple, 애플 또는 AAPL'} aria-label="종목명 또는 종목코드" />
        {result.isFetching && <LoaderCircle className="spin search-loader" size={18} />}
        <button disabled={!input.trim() || result.isFetching}>검색</button>
      </form>
      <p className="search-hint">현재 {isDomestic ? '국내' : '해외'} {isLive ? '실투자 조회' : '모의투자'} 환경에 맞는 종목만 검색합니다.</p>
      <RecentSearches searches={recentSearches} onSelect={search} onRemove={removeRecentSearch} onClear={clearRecentSearches} />
    </section>

    {result.isError && <div className="search-message error"><AlertCircle size={25} /><div><b>검색 결과를 불러오지 못했습니다</b><span>{result.error.message}</span></div></div>}
    {!query && <div className="search-message"><Search size={28} /><div><b>검색어를 입력해 주세요</b><span>종목명 또는 종목코드의 일부만 입력해도 검색할 수 있습니다.</span></div></div>}
    {query && result.isSuccess && result.data.length === 0 && <div className="search-message"><SearchX size={28} /><div><b>검색 결과가 없습니다</b><span>종목명이나 종목코드를 확인한 뒤 다시 검색해 주세요.</span></div></div>}
    {query && result.data && result.data.length > 0 && <section className="search-results">
      <div className="result-heading"><div><h2>검색 결과</h2><p>“{query}” 검색 결과</p></div><span>{result.data.length}개</span></div>
      <ul>{result.data.map((stock) => <li key={`${stock.market}-${stock.code}`}>
        <button className="stock-result-button" onClick={() => onSelectStock(stock)} aria-label={`${stock.name || stock.code} 종목 정보 열기`}>
        <span className="stock-symbol"><Building2 size={18} /></span>
        <div className="result-name"><b>{stock.name || stock.englishName || stock.code}</b>{stock.englishName && <span>{stock.englishName}</span>}</div>
        <div className="result-meta"><b>{stock.code}</b><span>{stock.market}{stock.sector ? ` · ${stock.sector}` : ''}</span></div>
        <div className="result-badges">{stock.isEtf && <span>ETF</span>}{stock.status && stock.status !== '정상' && <span className="warning">{stock.status}</span>}</div>
        </button>
        <WatchlistButton stock={stock} selected={isWatchlisted(stock)} onToggle={onToggleWatchlist} />
      </li>)}</ul>
    </section>}
  </>
}
