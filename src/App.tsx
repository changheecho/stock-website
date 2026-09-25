import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownRight, ArrowUpRight, BarChart3, BriefcaseBusiness, ChevronRight,
  CircleDollarSign, Clock3, ListOrdered, LogOut, Menu, RefreshCw, Search, ShieldCheck, WalletCards, X,
} from 'lucide-react'
import { fetchAccount } from './api'
import StockSearch from './StockSearch'
import StockTradePanel from './StockTradePanel'
import Rankings from './Rankings'
import HoldingsTable from './HoldingsTable'
import type { AccountView, Environment, Feature, Holding, StockSearchItem, TradeSelection } from './types'

const environments: { id: Environment; label: string; detail: string }[] = [
  { id: 'domestic-live', label: '국내 실투자', detail: '조회 전용' },
  { id: 'overseas-live', label: '해외 실투자', detail: '조회 전용' },
  { id: 'domestic-mock', label: '국내 모의투자', detail: 'KRX' },
  { id: 'overseas-mock', label: '해외 모의투자', detail: 'US' },
]

function isUsMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  if (['Sat', 'Sun'].includes(value.weekday)) return false
  const minutes = Number(value.hour) * 60 + Number(value.minute)
  return minutes >= 570 && minutes < 960
}

const formatMoney = (value: number, currency: AccountView['currency']) =>
  new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2,
  }).format(value)

const formatNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits }).format(value)

function ChangeValue({ value, suffix = '', money }: { value: number; suffix?: string; money?: AccountView['currency'] }) {
  const positive = value >= 0
  return <span className={`change ${positive ? 'positive' : 'negative'}`}>
    {positive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
    {money ? formatMoney(Math.abs(value), money) : `${formatNumber(Math.abs(value), 2)}${suffix}`}
  </span>
}

function SummaryCard({ label, value, helper, icon: Icon }: {
  label: string; value: string; helper?: React.ReactNode; icon: typeof WalletCards
}) {
  return <article className="summary-card">
    <div className="card-heading"><span>{label}</span><span className="icon-box"><Icon size={18} /></span></div>
    <strong>{value}</strong>
    {helper && <div className="card-helper">{helper}</div>}
  </article>
}

function App() {
  const [environment, setEnvironment] = useState<Environment>(() => isUsMarketOpen() ? 'overseas-mock' : 'domestic-mock')
  const [feature, setFeature] = useState<Feature>('account')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [tradeSelection, setTradeSelection] = useState<TradeSelection | null>(null)
  const query = useQuery({ queryKey: ['account', environment], queryFn: () => fetchAccount(environment), enabled: feature === 'account' })
  const selected = environments.find((item) => item.id === environment)!
  const tradingEnabled = environment.endsWith('-mock')
  const refreshedAt = useMemo(() => query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : null, [query.dataUpdatedAt])
  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' })
    window.location.assign('/login')
  }

  useEffect(() => { setMobileMenu(false); setTradeSelection(null) }, [environment])
  const openBuy = (stock: StockSearchItem) => setTradeSelection({ stock, side: 'buy' })
  const openSell = (holding: Holding) => setTradeSelection({
    side: 'sell', availableQuantity: holding.availableQuantity,
    stock: { code: holding.code, name: holding.name, market: holding.exchange ?? (environment.startsWith('domestic-') ? 'KRX' : '미국') },
  })

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><BarChart3 size={21} /></div><div><b>Portfolio Desk</b><span>개인 투자 관리</span></div></div>
      <button className="logout-button" onClick={() => void logout()}><LogOut size={16} /><span>로그아웃</span></button>
      <div className="environment-picker" aria-label="투자 환경 선택">
        {environments.map((item) => <button key={item.id} className={environment === item.id ? 'selected' : ''} onClick={() => setEnvironment(item.id)}>
          <span className="status-dot" /> <span>{item.label}<small>{item.detail}</small></span>
        </button>)}
      </div>
      <button className="mobile-menu-button" onClick={() => setMobileMenu((open) => !open)} aria-label="메뉴 열기">{mobileMenu ? <X /> : <Menu />}</button>
    </header>

    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <nav><p>투자 관리</p>
        <button className={feature === 'account' ? 'active' : ''} onClick={() => setFeature('account')}><WalletCards size={19} /><span>계좌 확인</span><ChevronRight size={16} /></button>
        <button className={feature === 'stock-search' ? 'active' : ''} onClick={() => setFeature('stock-search')}><Search size={19} /><span>종목 검색</span><ChevronRight size={16} /></button>
        <button className={feature === 'rankings' ? 'active' : ''} onClick={() => setFeature('rankings')}><ListOrdered size={19} /><span>순위</span><ChevronRight size={16} /></button>
      </nav>
      <div className="security-note"><ShieldCheck size={20} /><div><b>보안 연결</b><span>인증정보는 서버에서만 사용됩니다.</span></div></div>
    </aside>

    <main>{feature === 'stock-search' ? <StockSearch environment={environment} onSelectStock={openBuy} /> : feature === 'rankings' ? <Rankings environment={environment} onSelectStock={openBuy} /> : <>
      <section className="page-heading">
        <div><div className="eyebrow"><span className="live-dot" />{selected.label} · {selected.detail}</div><h1>계좌 확인</h1><p>보유 자산과 수익 현황을 한눈에 확인하세요.</p></div>
        <button className="refresh-button" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={17} className={query.isFetching ? 'spin' : ''} />{query.isFetching ? '업데이트 중' : '새로고침'}</button>
      </section>

      {query.isLoading && <div className="loading-grid" aria-label="계좌 정보 로딩 중">{[1,2,3,4].map((n) => <div className="skeleton" key={n} />)}</div>}
      {query.isError && <div className="error-state"><CircleDollarSign size={30} /><h2>계좌 정보를 불러오지 못했습니다</h2><p>{query.error.message}</p><button onClick={() => query.refetch()}>다시 시도</button></div>}
      {query.data && <>
        <section className="summary-grid">
          <SummaryCard label="예수금" value={formatMoney(query.data.cashBalance, query.data.cashCurrency)} icon={CircleDollarSign} helper={query.data.currency === 'USD' ? 'D0 외화예수금' : '계좌 현금 잔고'} />
          <SummaryCard label={query.data.availableLabel} value={formatMoney(query.data.availableAmount, query.data.availableCurrency)} icon={WalletCards} helper={query.data.currency === 'USD' ? 'D0 원화환산 추정액' : '현재 주문 가능 기준'} />
          <SummaryCard label="총 평가 금액" value={formatMoney(query.data.totalEvaluation, query.data.currency)} icon={WalletCards} helper={query.data.estimatedAssets !== undefined ? `추정 예탁자산 ${formatMoney(query.data.estimatedAssets, query.data.currency)}` : '현재 보유 자산 기준'} />
          <SummaryCard label="총 매입 금액" value={formatMoney(query.data.totalPurchase, query.data.currency)} icon={BriefcaseBusiness} helper={`${query.data.holdings.length}개 종목 보유`} />
          <SummaryCard label="평가 손익" value={formatMoney(query.data.totalProfitLoss, query.data.currency)} icon={query.data.totalProfitLoss >= 0 ? ArrowUpRight : ArrowDownRight} helper={<ChangeValue value={query.data.totalProfitLoss} money={query.data.currency} />} />
          <SummaryCard label="총 수익률" value={`${query.data.totalReturnRate >= 0 ? '+' : ''}${formatNumber(query.data.totalReturnRate, 2)}%`} icon={BarChart3} helper={<ChangeValue value={query.data.totalReturnRate} suffix="%" />} />
        </section>

        <section className="holdings-card">
          <div className="section-heading"><div><h2>보유 종목</h2><p>현재 계좌의 종목별 평가 현황입니다.</p></div>{refreshedAt && <span><Clock3 size={14} /> {refreshedAt} 기준</span>}</div>
          <HoldingsTable holdings={query.data.holdings} currency={query.data.currency} onSell={openSell} tradingEnabled={tradingEnabled} />
        </section>
      </>}
    </>}
    </main>
    <StockTradePanel environment={environment} selection={tradeSelection} onClose={() => setTradeSelection(null)} />
  </div>
}

export default App
