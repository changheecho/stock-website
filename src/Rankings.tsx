import { useQuery } from '@tanstack/react-query'
import { BarChart3, Flame, LoaderCircle, RefreshCw, Search, TrendingUp } from 'lucide-react'
import { fetchRankings } from './api'
import type { Environment, RankingItem, StockSearchItem } from './types'
import { WatchlistButton } from './Watchlist'

type Props = { environment: Environment; onSelectStock: (stock: StockSearchItem) => void; isWatchlisted: (stock: StockSearchItem) => boolean; onToggleWatchlist: (stock: StockSearchItem) => void }
const cards = [
  { key: 'value' as const, title: '거래대금 상위', icon: BarChart3 },
  { key: 'gainers' as const, title: '상승률 상위', icon: TrendingUp },
  { key: 'volume' as const, title: '거래량 상위', icon: Flame },
  { key: 'popular' as const, title: '인기검색 순위', icon: Search },
]
const compact = (value: number) => new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const price = (value: number, overseas: boolean) => new Intl.NumberFormat(overseas ? 'en-US' : 'ko-KR', { style: 'currency', currency: overseas ? 'USD' : 'KRW', maximumFractionDigits: overseas ? 2 : 0 }).format(value)

function RankingRow({ item, kind, overseas, onSelect, isWatchlisted, onToggleWatchlist }: { item: RankingItem; kind: typeof cards[number]['key']; overseas: boolean; onSelect: () => void; isWatchlisted: boolean; onToggleWatchlist: () => void }) {
  const metric = kind === 'gainers' ? `${item.metric >= 0 ? '+' : ''}${item.metric.toFixed(2)}%` : kind === 'popular' ? `${item.metric > 0 ? '+' : ''}${item.metric}` : compact(item.metric)
  return <li><button className="ranking-stock-button" onClick={onSelect} aria-label={`${item.name} 종목 정보 열기`}>
    <b className={`rank-number ${item.rank <= 3 ? 'top' : ''}`}>{item.rank}</b>
    <div className="ranking-name"><strong>{item.name || item.code}</strong><span>{item.code}{item.englishName ? ` · ${item.englishName}` : ''}</span></div>
    <div className="ranking-price"><strong>{price(item.price, overseas)}</strong><span className={item.changeRate >= 0 ? 'positive' : 'negative'}>{item.changeRate >= 0 ? '+' : ''}{item.changeRate.toFixed(2)}%</span></div>
    <b className={kind === 'gainers' ? (item.metric >= 0 ? 'positive' : 'negative') : ''}>{metric}</b>
  </button><WatchlistButton stock={{ code: item.code, name: item.name, englishName: item.englishName, market: item.market }} selected={isWatchlisted} onToggle={onToggleWatchlist} /></li>
}

export default function Rankings({ environment, onSelectStock, isWatchlisted, onToggleWatchlist }: Props) {
  const overseas = environment.startsWith('overseas-')
  const query = useQuery({ queryKey: ['rankings', environment], queryFn: () => fetchRankings(environment), staleTime: 30_000 })
  return <>
    <section className="page-heading ranking-heading"><div><div className="eyebrow"><span className="live-dot" />시장 탐색</div><h1>종목 순위</h1><p>시장 흐름을 이끄는 종목을 빠르게 확인하세요.</p></div><button className="refresh-button" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={17} className={query.isFetching ? 'spin' : ''} />새로고침</button></section>
    <div className="market-tabs ranking-tabs"><button className={!overseas ? 'active' : ''} disabled={overseas}>국내 <small>KRX</small></button><button className={overseas ? 'active' : ''} disabled={!overseas}>해외 <small>NYSE · NASDAQ · AMEX</small></button></div>
    {query.isLoading && <div className="ranking-loading"><LoaderCircle className="spin" /> 순위 정보를 불러오는 중입니다.</div>}
    {query.isError && <div className="error-state"><BarChart3 size={28} /><h2>순위 정보를 불러오지 못했습니다</h2><p>{query.error.message}</p><button onClick={() => query.refetch()}>다시 시도</button></div>}
    {query.data && <div className="ranking-grid">{cards.map(({ key, title, icon: Icon }) => <section className="ranking-card" key={key}><div className="ranking-card-title"><div><span><Icon size={16} /></span><h2>{title}</h2></div><small>TOP 10</small></div>{query.data[key].length ? <ol>{query.data[key].map((item) => { const stock = { code: item.code, name: item.name, englishName: item.englishName, market: item.market }; return <RankingRow key={`${item.market}-${item.code}-${item.rank}`} item={item} kind={key} overseas={overseas} onSelect={() => onSelectStock(stock)} isWatchlisted={isWatchlisted(stock)} onToggleWatchlist={() => onToggleWatchlist(stock)} /> })}</ol> : <div className="ranking-empty">표시할 순위가 없습니다.</div>}</section>)}</div>}
  </>
}
