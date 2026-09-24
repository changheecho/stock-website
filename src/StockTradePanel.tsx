import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, ShoppingCart, X } from 'lucide-react'
import { fetchOrderStatus, fetchStockQuote, placeTradeOrder } from './api'
import type { Environment, TradeSelection } from './types'

type Props = {
  environment: Environment
  selection: TradeSelection | null
  onClose: () => void
}

const money = (value: number, currency: 'KRW' | 'USD') => new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US', {
  style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 4,
}).format(value)

export default function StockTradePanel({ environment, selection, onClose }: Props) {
  const stock = selection?.stock ?? null
  const side = selection?.side ?? 'buy'
  const isSell = side === 'sell'
  const isLive = environment.endsWith('-live')
  const isDomestic = environment.startsWith('domestic-')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [receipt, setReceipt] = useState<{ orderNo: string; message: string } | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const requestId = useRef('')
  const queryClient = useQueryClient()
  const quote = useQuery({
    queryKey: ['stock-quote', environment, stock?.code, stock?.market],
    queryFn: () => fetchStockQuote(environment, stock!),
    enabled: Boolean(stock),
    staleTime: 5_000,
  })
  const orderStatus = useQuery({
    queryKey: ['order-status', environment, stock?.code, receipt?.orderNo],
    queryFn: () => fetchOrderStatus(environment, stock!, side, receipt!.orderNo),
    enabled: Boolean(stock && receipt && !isLive),
    refetchInterval: (query) => query.state.data?.state === 'filled' ? false : 3_000,
  })
  const order = useMutation({
    mutationFn: () => placeTradeOrder(environment, stock!, side, Number(quantity), Number(price), requestId.current),
    onSuccess: (data) => {
      setReceipt(data)
      setConfirming(false)
      setNotice({ kind: 'success', message: data.message })
      void queryClient.invalidateQueries({ queryKey: ['account', environment] })
    },
    onError: (error) => {
      setConfirming(false)
      setNotice({ kind: 'error', message: error.message })
      requestId.current = ''
    },
  })

  useEffect(() => {
    setQuantity('1'); setPrice(''); setConfirming(false); setReceipt(null); setNotice(null); requestId.current = ''
  }, [stock?.code, environment, side])
  useEffect(() => {
    if (quote.data?.currentPrice && !price) setPrice(String(quote.data.currentPrice))
  }, [quote.data?.currentPrice, price])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const total = useMemo(() => Number(quantity || 0) * Number(price || 0), [quantity, price])
  const validQuantity = Number.isInteger(Number(quantity)) && Number(quantity) > 0 && (!isSell || Number(quantity) <= (selection?.availableQuantity ?? 0))
  const valid = validQuantity && Number(price) > 0
  if (!stock) return null

  const startConfirmation = () => {
    if (!valid || !quote.data?.canBuy) return
    requestId.current = crypto.randomUUID()
    setConfirming(true)
  }

  return <div className="trade-layer" role="presentation">
    <button className="trade-backdrop" aria-label="거래 패널 닫기" onClick={onClose} />
    <aside className="trade-panel" role="dialog" aria-modal="true" aria-label={`${stock.name} 거래 패널`}>
      <div className="trade-header"><div><span>{isDomestic ? '국내' : '해외'} {isLive ? '실투자 조회' : '모의투자'}</span><h2>{stock.name || stock.code}</h2><p>{stock.code} · {stock.market}</p></div><button onClick={onClose} aria-label="닫기"><X size={20} /></button></div>

      {quote.isLoading && <div className="panel-loading"><LoaderCircle className="spin" /> 종목 정보를 불러오는 중</div>}
      {quote.isError && <div className="panel-error"><AlertTriangle size={18} />{quote.error.message}<button onClick={() => quote.refetch()}><RefreshCw size={14} /> 다시 시도</button></div>}
      {quote.data && <>
        <section className="quote-summary"><div><span>현재가</span><strong>{money(quote.data.currentPrice, quote.data.currency)}</strong><small className={quote.data.change >= 0 ? 'positive' : 'negative'}>{quote.data.change >= 0 ? '+' : ''}{money(quote.data.change, quote.data.currency)} ({quote.data.changeRate >= 0 ? '+' : ''}{quote.data.changeRate.toFixed(2)}%)</small></div><dl><div><dt>고가</dt><dd>{money(quote.data.high, quote.data.currency)}</dd></div><div><dt>저가</dt><dd>{money(quote.data.low, quote.data.currency)}</dd></div><div><dt>거래량</dt><dd>{quote.data.volume.toLocaleString('ko-KR')}</dd></div></dl></section>

        {isLive ? <div className="buy-unavailable"><ShieldCheck size={20} /><div><b>실투자 조회 전용</b><span>현재가 정보만 제공하며 매수·매도 주문은 차단되어 있습니다.</span></div></div> : !quote.data.canBuy ? <div className="buy-unavailable"><AlertTriangle size={20} /><div><b>매수할 수 없는 종목입니다</b><span>{quote.data.unavailableReason}</span></div></div> : <section className="buy-form">
          <div className="buy-title"><div><ShoppingCart size={18} /><b>지정가 {isSell ? '매도' : '매수'}</b></div><span>모의투자</span></div>
          {isSell && <div className="available-quantity"><span>매도 가능 수량</span><strong>{selection?.availableQuantity?.toLocaleString('ko-KR') ?? 0}주</strong></div>}
          <label>주문 수량<div className="input-with-unit"><input type="number" min="1" max={isSell ? selection?.availableQuantity : undefined} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={Boolean(receipt)} /><span>주</span></div></label>
          {isSell && Number(quantity) > (selection?.availableQuantity ?? 0) && <p className="quantity-error">매도 가능 수량을 초과할 수 없습니다.</p>}
          <label>주문 가격<div className="input-with-unit"><input type="number" min={quote.data.currency === 'KRW' ? '1' : '0.0001'} step={quote.data.currency === 'KRW' ? '1' : Number(price) < 1 ? '0.0001' : '0.01'} value={price} onChange={(event) => setPrice(event.target.value)} disabled={Boolean(receipt)} /><span>{quote.data.currency}</span></div></label>
          <div className="order-total"><span>예상 주문금액</span><strong>{money(total, quote.data.currency)}</strong></div>
          {!receipt && <button className={`buy-button ${isSell ? 'sell' : ''}`} disabled={!valid || order.isPending} onClick={startConfirmation}>{isSell ? '매도' : '매수'} 주문 확인</button>}
        </section>}

        {confirming && <section className="confirm-box"><div><ShieldCheck size={22} /><b>주문 내용을 최종 확인해 주세요</b><p>{stock.name} {Number(quantity).toLocaleString()}주를 주당 {money(Number(price), quote.data.currency)}에 {isSell ? '매도' : '매수'}합니다.{isSell && ' 주문 직전에 최신 매도 가능 수량을 다시 확인합니다.'}</p><strong>총 {money(total, quote.data.currency)}</strong></div><div className="confirm-actions"><button onClick={() => { setConfirming(false); requestId.current = '' }} disabled={order.isPending}>취소</button><button onClick={() => order.mutate()} disabled={order.isPending}>{order.isPending ? <><LoaderCircle className="spin" size={16} /> 주문 처리 중</> : `모의 ${isSell ? '매도' : '매수'} 주문`}</button></div></section>}

        {receipt && <section className="order-result"><div className="result-status"><CheckCircle2 size={21} /><div><b>주문 접수 완료</b><span>주문번호 {receipt.orderNo}</span></div></div><div className="fill-status"><span>체결 상태</span>{orderStatus.isLoading ? <b><LoaderCircle className="spin" size={14} /> 확인 중</b> : orderStatus.isError ? <b className="negative">조회 실패</b> : <b className={orderStatus.data?.state === 'filled' ? 'positive' : ''}>{orderStatus.data?.label}</b>}</div>{orderStatus.data && <div className="fill-detail"><span>체결 {orderStatus.data.filledQuantity.toLocaleString()}주</span><span>미체결 {orderStatus.data.remainingQuantity.toLocaleString()}주</span></div>}</section>}
      </>}
      <div className="mock-notice"><ShieldCheck size={16} /><span>{isLive ? '실투자 환경에서는 조회 기능만 사용할 수 있습니다.' : '모든 주문은 키움 모의투자 환경에서만 실행됩니다.'}</span></div>
    </aside>
    {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{notice.message}</div>}
  </div>
}
